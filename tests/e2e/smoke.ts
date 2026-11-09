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

function waitForJob(id: number, what: string, timeoutMs: number) {
  return until(
    what,
    async () => {
      const j = await api<{ state: string; step: string; message: string }>(view, `/api/jobs/${id}`)
      if (j.body.state === 'failed')
        throw Object.assign(new Error(`job failed at ${j.body.step}: ${j.body.message}`), {
          fatal: true,
        })
      return j.body.state === 'succeeded' ? j.body : null
    },
    timeoutMs,
    2000,
  )
}

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
    const job = await waitForJob(created.body.jobId, 'the create-server job', 10 * 60_000)
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

    // Backups: a block placed before the backup survives a change and a restore.
    const rcon = async (command: string) => {
      const r = await api<{ reply: string }>(view, '/api/servers/smoke/command', {
        body: { command },
      })
      if (r.status !== 200) throw new Error(`${command} failed: ${JSON.stringify(r.body)}`)
      return r.body.reply
    }
    const goldIsThere = async () =>
      /passed/i.test(await rcon('execute if block 0 100 0 minecraft:gold_block'))
    await rcon('forceload add 0 0')
    await rcon('setblock 0 100 0 minecraft:gold_block')
    if (!(await goldIsThere())) throw new Error('setblock did not place the gold block')

    const backup = await api<{ jobId: number }>(view, '/api/servers/smoke/backups', {
      body: { note: 'e2e' },
    })
    if (backup.status !== 200) throw new Error(`backup failed: ${JSON.stringify(backup.body)}`)
    await waitForJob(backup.body.jobId, 'the backup job', 5 * 60_000)
    step('backed up a running server')

    await rcon('setblock 0 100 0 minecraft:air')
    if (await goldIsThere()) throw new Error('the gold block should be gone before restoring')

    await view.navigate(`${base}/servers/smoke/backups`)
    await waitForText(view, 'e2e', 30_000)
    // Menus open on a real pointer press, so use native clicks here.
    await view.click('[aria-label^="Actions for backup"]')
    await until('the Restore menu item', () =>
      view.evaluate<boolean>(`(() => {
        const i = [...document.querySelectorAll('[role=menuitem]')].find((e) => e.innerText.includes('Restore'))
        if (!i) return false
        i.setAttribute('data-e2e', 'restore')
        return true
      })()`),
    )
    await view.click('[data-e2e=restore]')
    await waitForText(view, 'Restore this backup?')
    await clickButton(view, 'Restore')
    await waitForText(view, 'Restored the backup', 5 * 60_000)
    await shot('3-restored')
    await until(
      'RCON after the restore',
      async () =>
        (await api(view, '/api/servers/smoke/command', { body: { command: 'list' } })).status ===
        200,
      5 * 60_000,
      2000,
    )
    if (!(await goldIsThere())) throw new Error('the restore did not bring the gold block back')
    step('restored the backup through the UI and the block came back')

    // World export: a zip with level.dat that unzip accepts, shared through a public link.
    const exported = await api<{ jobId: number }>(view, '/api/servers/smoke/exports', { body: {} })
    if (exported.status !== 200) throw new Error(`export failed: ${JSON.stringify(exported.body)}`)
    await waitForJob(exported.body.jobId, 'the export job', 5 * 60_000)
    const list = await api<{ id: number }[]>(view, '/api/servers/smoke/exports')
    const link = await api<{ url: string }>(
      view,
      `/api/servers/smoke/exports/${list.body[0]!.id}/shares`,
      {
        body: { ttl: '1h' },
      },
    )
    const zipRes = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, base))
    if (zipRes.status !== 200) throw new Error(`share link answered ${zipRes.status}`)
    const zipPath = `${process.env.RUNNER_TEMP ?? '/tmp'}/smoke-world.zip`
    await Bun.write(zipPath, zipRes)
    const test = Bun.spawnSync(['unzip', '-tq', zipPath])
    const names = Bun.spawnSync(['unzip', '-Z1', zipPath]).stdout.toString()
    if (test.exitCode !== 0 || !/\/level\.dat$/m.test(names)) {
      throw new Error(`bad export zip: ${test.stdout}${test.stderr}`)
    }
    step(
      `exported the world and downloaded it through a share link (${zipRes.headers.get('content-length')} bytes)`,
    )

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
