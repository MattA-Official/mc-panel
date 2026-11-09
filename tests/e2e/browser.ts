/**
 * Small helpers over Bun.WebView for end-to-end tests: waiting for text, filling inputs and
 * a passkey-capable virtual authenticator over CDP.
 */
export type View = InstanceType<typeof Bun.WebView>

export async function openBrowser(url: string): Promise<View> {
  const view = new Bun.WebView({
    backend: {
      type: 'chrome',
      url: false,
      ...(process.env.CHROME_PATH ? { path: process.env.CHROME_PATH } : {}),
      // Root (CI containers, sandboxes) can't use Chrome's sandbox.
      argv: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
      stderr: process.env.E2E_CONSOLE ? 'inherit' : 'ignore',
    },
    width: 1200,
    height: 800,
    console: process.env.E2E_CONSOLE ? globalThis.console : undefined,
  })
  await view.navigate(url)
  // A platform authenticator that always verifies the user, like Touch ID saying yes.
  await view.cdp('WebAuthn.enable')
  await view.cdp('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return view
}

/** Polls until `check` returns something truthy. */
export async function until<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
  everyMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    // Errors marked `fatal` stop the wait; anything else counts as "not yet".
    const value = await check().catch((err) => {
      if ((err as { fatal?: boolean }).fatal) throw err
      return null
    })
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(everyMs)
  }
}

export const waitForText = (view: View, text: string, timeoutMs?: number) =>
  until(
    `"${text}"`,
    () => view.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(text)})`),
    timeoutMs,
  )

export const waitForPath = (view: View, path: string, timeoutMs?: number) =>
  until(
    `path ${path}`,
    () => view.evaluate<boolean>(`location.pathname === ${JSON.stringify(path)}`),
    timeoutMs,
  )

/** Sets an input's value the way Vue's v-model hears it. */
export async function fill(view: View, selector: string, value: string) {
  await until(`input ${selector}`, () =>
    view.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`),
  )
  await view.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    el.focus()
    el.value = ${JSON.stringify(value)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}

/** Clicks the first button whose text contains `label`. */
export async function clickButton(view: View, label: string) {
  await until(`button "${label}"`, () =>
    view.evaluate<boolean>(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.innerText.includes(${JSON.stringify(label)}) && !b.disabled,
      )
      if (!b) return false
      b.click()
      return true
    })()`),
  )
}

/** fetch() from inside the page, so the session cookie goes along. */
export function api<T>(view: View, path: string, init?: { method?: string; body?: unknown }) {
  const opts = init
    ? `{ method: ${JSON.stringify(init.method ?? 'POST')}, headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(init.body ?? {}))} }`
    : '{}'
  return view.evaluate<{ status: number; body: T }>(
    `fetch(${JSON.stringify(path)}, ${opts}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`,
  )
}
