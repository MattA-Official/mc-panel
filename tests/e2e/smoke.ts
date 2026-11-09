/**
 * Drives a freshly installed panel the way a person would: first-run setup with a passkey,
 * then (unless E2E_SKIP_SERVER is set) a real Fabric server created, started and talked to.
 *
 *   E2E_URL=http://localhost:3000 E2E_SETUP_TOKEN=... bun tests/e2e/smoke.ts
 */
import { api, clickButton, fill, openBrowser, until, waitForPath, waitForText } from './browser.ts'

const base = process.env.E2E_URL ?? 'http://localhost:3000'
const token = process.env.E2E_SETUP_TOKEN ?? 'dev-setup-token'
const shots = process.env.E2E_SHOTS

const step = (msg: string) => console.log(`✓ ${msg}`)
const view = await openBrowser(base + '/')

async function shot(name: string) {
  if (shots) await Bun.write(`${shots}/${name}.png`, await view.screenshot())
}

try {
  await waitForPath(view, '/setup')
  await fill(view, 'input', 'not-the-token')
  await clickButton(view, 'Continue')
  await waitForText(view, 'That setup token is not right')
  await fill(view, 'input', token)
  await clickButton(view, 'Continue')
  await waitForText(view, 'Create your passkey')
  await fill(view, 'input', 'Smoke Test')
  await clickButton(view, 'Create passkey')
  await waitForText(view, 'Save your recovery codes')
  const codes = await view.evaluate<string[]>(
    `[...document.querySelectorAll('ol li')].map((li) => li.innerText.trim())`,
  )
  if (codes.length !== 10) throw new Error(`expected 10 recovery codes, got ${codes.length}`)
  await clickButton(view, "I've saved them")
  await fill(view, 'input', codes[0]!)
  await clickButton(view, 'Finish setup')
  await waitForPath(view, '/')
  await shot('1-home')
  step('setup with passkey and recovery codes')

  const health = await api<{ agent: { ok: boolean; version: string } }>(view, '/api/health')
  if (!health.body.agent.ok) throw new Error('the panel cannot reach the agent')
  step(`agent ${health.body.agent.version} reachable`)

  if (!process.env.E2E_SKIP_SERVER) {
    const versions = await api<{ id: string }[]>(view, '/api/loaders/fabric/minecraft')
    const mc = process.env.E2E_MC_VERSION ?? versions.body[0]?.id
    if (!mc) throw new Error(`no Minecraft versions (${versions.status})`)
    const created = await api<{ jobId: number }>(view, '/api/servers', {
      body: {
        name: 'smoke',
        displayName: 'Smoke',
        loader: 'fabric',
        mcVersion: mc,
        memoryMb: 1024,
        acceptEula: true,
      },
    })
    if (created.status !== 202) throw new Error(`create failed: ${JSON.stringify(created.body)}`)
    const job = await until(
      'the create-server job',
      async () => {
        const j = await api<{ state: string; step: string; message: string }>(
          view,
          `/api/jobs/${created.body.jobId}`,
        )
        if (j.body.state === 'failed')
          throw Object.assign(new Error(`job failed at ${j.body.step}: ${j.body.message}`), {
            fatal: true,
          })
        return j.body.state === 'succeeded' ? j.body : null
      },
      10 * 60_000,
      2000,
    )
    step(`created Fabric ${mc}: ${job.message}`)

    await view.navigate(`${base}/servers/smoke`)
    await waitForText(view, 'Running', 30_000)
    await until(
      'the server to finish starting',
      () =>
        view.evaluate<boolean>(
          `document.querySelector('[role=log]')?.innerText.includes('Done (')`,
        ),
      5 * 60_000,
      2000,
    )
    await shot('2-console')
    step('server started and console streaming')

    const reply = await until(
      'RCON',
      async () => {
        const r = await api<{ reply: string }>(view, '/api/servers/smoke/command', {
          body: { command: 'list' },
        })
        return r.status === 200 ? r.body.reply : null
      },
      60_000,
      2000,
    )
    if (!/players online/.test(reply)) throw new Error(`unexpected RCON reply: ${reply}`)
    step(`RCON answered: ${reply}`)

    const stopped = await api(view, '/api/servers/smoke/stop', { body: {} })
    if (stopped.status !== 200) throw new Error(`stop failed: ${JSON.stringify(stopped.body)}`)
    step('server stopped')
  }
  console.log('smoke test passed')
} catch (err) {
  await shot('failure').catch(() => {})
  console.error(`✗ ${(err as Error).message}`)
  process.exitCode = 1
} finally {
  view.close()
  Bun.WebView.closeAll()
}
