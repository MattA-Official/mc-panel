import { generateKeyPairSync, sign } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { dispatch } from '../src/dispatch'
import { handlers } from '../src/handlers'
import { readRecord, runUpdate } from '../src/updater'
import { fakeContext, fakeExec } from './fakes'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const sha256 = (b: Uint8Array | string) => new Bun.CryptoHasher('sha256').update(b).digest('hex')

/** A machine with 0.4.0 installed and running. */
function layout() {
  const root = mkdtempSync(join(tmpdir(), 'ft-up-'))
  const prefix = join(root, 'opt')
  const p = {
    servers: join(root, 'srv'),
    runtimes: join(prefix, 'runtimes'),
    archive: join(root, 'archive'),
    config: join(root, 'etc'),
    systemd: join(root, 'systemd'),
    state: join(root, 'state'),
    prefix,
    panelData: join(root, 'data'),
  }
  for (const d of [p.config, p.systemd, p.state, p.panelData, join(prefix, 'releases', '0.4.0')]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(join(prefix, 'releases', '0.4.0', 'VERSION'), '0.4.0')
  symlinkSync(join(prefix, 'releases', '0.4.0'), join(prefix, 'current'))
  writeFileSync(join(p.config, 'panel.env'), 'NUXT_VERSION=0.4.0\nPORT=3000\n')
  writeFileSync(
    join(p.systemd, 'flytower-agent.service'),
    '[Service]\nEnvironment=FLYTOWER_VERSION=0.4.0\n',
  )
  writeFileSync(join(p.panelData, 'flytower.db'), 'old database')
  return { root, p }
}

/** A signed 0.5.0 release, as a tarball built with the real tar. */
async function release(root: string, opts: { badSig?: boolean } = {}) {
  const src = join(root, 'build', 'flytower-0.5.0')
  mkdirSync(join(src, 'agent'), { recursive: true })
  mkdirSync(join(src, 'bin'), { recursive: true })
  writeFileSync(join(src, 'VERSION'), '0.5.0')
  writeFileSync(join(src, 'agent', 'updater.js'), '')
  writeFileSync(join(src, 'bin', 'bun'), '')
  const tgz = join(root, 'build', 'flytower-0.5.0-linux-amd64.tar.gz')
  Bun.spawnSync(['tar', '-czf', tgz, '-C', join(root, 'build'), 'flytower-0.5.0'])
  const bytes = readFileSync(tgz)
  const sums = `${sha256(bytes)}  flytower-0.5.0-linux-amd64.tar.gz\n`
  const sig = sign(null, Buffer.from(opts.badSig ? sums + 'x' : sums), privateKey).toString(
    'base64',
  )
  const requested: string[] = []
  const fetch = (async (url: string) => {
    requested.push(String(url))
    if (String(url).endsWith('/SHA256SUMS')) return new Response(sums)
    if (String(url).endsWith('/SHA256SUMS.sig')) return new Response(sig)
    if (String(url).endsWith('.tar.gz')) return new Response(bytes)
    return new Response('', { status: 404 })
  }) as never
  return { fetch, requested }
}

const call = (verb: string, params: object) => JSON.stringify({ id: '1', verb, params })

describe('update.install', () => {
  it('checks the signature and hash, unpacks, and starts the updater', async () => {
    const { root, p } = layout()
    const { fetch, requested } = await release(root)
    const fake = fakeExec()
    const calls = fake.calls
    // tar really runs; everything else is recorded.
    const exec: typeof fake.exec = async (file, args) => {
      if (file !== 'tar') return fake.exec(file, args)
      const r = Bun.spawnSync([file, ...args])
      return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
    }
    const { ctx } = fakeContext(exec, fetch, p)
    ctx.releaseKey = PUB
    ctx.releasesUrl = 'https://releases.test'
    const res = await dispatch(call('update.install', { version: '0.5.0' }), handlers, ctx)
    expect(res).toMatchObject({ ok: true, result: { started: true } })
    expect(requested[0]).toBe('https://releases.test/v0.5.0/SHA256SUMS')
    expect(readFileSync(join(p.prefix, 'releases', '0.5.0', 'VERSION'), 'utf8')).toBe('0.5.0')
    const run = calls.find((c) => c.file === 'systemd-run')!
    expect(run.args).toContain(join(p.prefix, 'releases', '0.5.0', 'agent', 'updater.js'))
    expect(run.args.at(-1)).toBe('0.5.0')
  })

  it('downloads native builds from their own tag', async () => {
    const { p } = layout()
    const requested: string[] = []
    const fetch = (async (url: string) => {
      requested.push(String(url))
      return new Response('', { status: 404 })
    }) as never
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, fetch, p)
    ctx.releasesUrl = 'https://releases.test'
    await dispatch(call('update.install', { version: '1.2.0-beta.2.native.1' }), handlers, ctx)
    expect(requested[0]).toBe('https://releases.test/native-1.2.0-beta.2.native.1/SHA256SUMS')
  })

  it('refuses a bad signature before downloading the archive', async () => {
    const { root, p } = layout()
    const { fetch, requested } = await release(root, { badSig: true })
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, fetch, p)
    ctx.releaseKey = PUB
    const res = await dispatch(call('update.install', { version: '0.5.0' }), handlers, ctx)
    expect(res).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('signature') },
    })
    expect(requested.some((u) => u.endsWith('.tar.gz'))).toBe(false)
    expect(existsSync(join(p.prefix, 'releases', '0.5.0'))).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses anything that is not a version, and the version already running', async () => {
    const { p } = layout()
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, p)
    expect(
      await dispatch(call('update.install', { version: '../../etc' }), handlers, ctx),
    ).toMatchObject({ ok: false, error: { code: 'invalid_params' } })
    expect(
      await dispatch(call('update.install', { version: '0.4.0' }), handlers, ctx),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })
})

describe('updater', () => {
  function install050(p: ReturnType<typeof layout>['p']) {
    mkdirSync(join(p.prefix!, 'releases', '0.5.0'), { recursive: true })
    writeFileSync(join(p.prefix!, 'releases', '0.5.0', 'VERSION'), '0.5.0')
  }

  it('switches over when the new version is healthy', async () => {
    const { p } = layout()
    install050(p)
    const { exec, calls } = fakeExec()
    const record = await runUpdate(
      {
        ...p,
        prefix: p.prefix!,
        panelData: p.panelData!,
        exec,
        health: async () => ({ version: '0.5.0', agent: { ok: true } }),
        sleep: async () => {},
      },
      '0.5.0',
    )
    expect(record).toMatchObject({ state: 'succeeded', from: '0.4.0', to: '0.5.0' })
    expect(readlinkSync(join(p.prefix!, 'current'))).toEndWith('/0.5.0')
    expect(readFileSync(join(p.config, 'panel.env'), 'utf8')).toContain('NUXT_VERSION=0.5.0')
    expect(readFileSync(join(p.systemd, 'flytower-agent.service'), 'utf8')).toContain(
      'FLYTOWER_VERSION=0.5.0',
    )
    // The copy is kept in the agent's own folder, root's alone, not beside the database.
    const copy = join(p.state, 'db-backups', 'flytower.db.before-0.5.0')
    expect(readFileSync(copy, 'utf8')).toBe('old database')
    expect(statSync(copy).mode & 0o777).toBe(0o600)
    expect(existsSync(join(p.panelData!, 'flytower.db.before-0.5.0'))).toBe(false)
    expect(calls.map((c) => c.args.join(' '))).toContain('restart flytower-agent.service')
    expect(await readRecord(p.state)).toMatchObject({ state: 'succeeded' })
  })

  it('rolls back, database included, when the new version never comes up', async () => {
    const { p } = layout()
    install050(p)
    const { exec } = fakeExec()
    let checks = 0
    const record = await runUpdate(
      {
        ...p,
        prefix: p.prefix!,
        panelData: p.panelData!,
        exec,
        health: async () => {
          // The new panel "migrates" the database, then reports the wrong version.
          if (checks++ === 0) writeFileSync(join(p.panelData!, 'flytower.db'), 'migrated')
          return { version: '0.4.0', agent: { ok: true } }
        },
        sleep: async () => {},
        healthTimeoutMs: 0,
      },
      '0.5.0',
    )
    expect(record).toMatchObject({ state: 'rolled-back', reason: 'the panel reported 0.4.0' })
    expect(readlinkSync(join(p.prefix!, 'current'))).toEndWith('/0.4.0')
    expect(readFileSync(join(p.config, 'panel.env'), 'utf8')).toContain('NUXT_VERSION=0.4.0')
    expect(readFileSync(join(p.panelData!, 'flytower.db'), 'utf8')).toBe('old database')
  })
})

describe('updater, when things go wrong', () => {
  function install050(p: ReturnType<typeof layout>['p']) {
    mkdirSync(join(p.prefix!, 'releases', '0.5.0'), { recursive: true })
    writeFileSync(join(p.prefix!, 'releases', '0.5.0', 'VERSION'), '0.5.0')
  }
  const deps = (p: ReturnType<typeof layout>['p'], exec: ReturnType<typeof fakeExec>['exec']) => ({
    ...p,
    prefix: p.prefix!,
    panelData: p.panelData!,
    exec,
    sleep: async () => {},
    healthTimeoutMs: 0,
  })

  it('leaves the live database alone and starts the old version if it can not be copied', async () => {
    const { p } = layout()
    install050(p)
    writeFileSync(join(p.panelData!, 'flytower.db-shm'), 'shared memory')
    // Not a regular file, so it can't be copied (as a full disk can't be written).
    mkdirSync(join(p.panelData!, 'flytower.db-wal'))
    const { exec, calls } = fakeExec()
    const record = await runUpdate(
      { ...deps(p, exec), health: async () => ({ version: '0.5.0', agent: { ok: true } }) },
      '0.5.0',
    )
    expect(record).toMatchObject({ state: 'failed', from: '0.4.0', to: '0.5.0' })
    expect(record.reason).toContain("couldn't copy the database first")
    expect(readFileSync(join(p.panelData!, 'flytower.db'), 'utf8')).toBe('old database')
    expect(readFileSync(join(p.panelData!, 'flytower.db-shm'), 'utf8')).toBe('shared memory')
    expect(readlinkSync(join(p.prefix!, 'current'))).toEndWith('/0.4.0')
    expect(calls.map((c) => c.args.join(' ')).at(-1)).toBe('start flytower-panel.service')
  })

  it('refuses to copy through a link planted in place of the database', async () => {
    const { root, p } = layout()
    install050(p)
    const secret = join(root, 'secret')
    writeFileSync(secret, 'root only')
    rmSync(join(p.panelData!, 'flytower.db'))
    symlinkSync(secret, join(p.panelData!, 'flytower.db'))
    // And a link where the copy goes: it must be replaced, never written through.
    mkdirSync(join(p.state, 'db-backups'), { recursive: true })
    const target = join(root, 'target')
    writeFileSync(target, 'untouched')
    symlinkSync(target, join(p.state, 'db-backups', 'flytower.db-wal.before-0.5.0'))
    const { exec } = fakeExec()
    const record = await runUpdate(
      { ...deps(p, exec), health: async () => ({ version: '0.5.0', agent: { ok: true } }) },
      '0.5.0',
    )
    expect(record.state).toBe('failed')
    expect(readdirSync(join(p.state, 'db-backups'))).not.toContain('flytower.db.before-0.5.0')
    expect(readFileSync(target, 'utf8')).toBe('untouched')
    expect(readFileSync(secret, 'utf8')).toBe('root only')
  })

  it('removes only the files the new version made when it rolls back', async () => {
    const { root, p } = layout()
    install050(p)
    const target = join(root, 'target')
    writeFileSync(target, 'untouched')
    const { exec } = fakeExec()
    const record = await runUpdate(
      {
        ...deps(p, exec),
        health: async () => {
          writeFileSync(join(p.panelData!, 'flytower.db'), 'migrated')
          writeFileSync(join(p.panelData!, 'flytower.db-wal'), 'new wal')
          // Something planted at a restore path is removed, not written through.
          rmSync(join(p.panelData!, 'flytower.db-shm'), { force: true })
          symlinkSync(target, join(p.panelData!, 'flytower.db-shm'))
          return { version: '0.4.0', agent: { ok: true } }
        },
      },
      '0.5.0',
    )
    expect(record.state).toBe('rolled-back')
    expect(readFileSync(join(p.panelData!, 'flytower.db'), 'utf8')).toBe('old database')
    expect(existsSync(join(p.panelData!, 'flytower.db-wal'))).toBe(false)
    expect(existsSync(join(p.panelData!, 'flytower.db-shm'))).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe('untouched')
  })
})

describe('update.install, one at a time', () => {
  it('refuses a release older than the one running', async () => {
    const { p } = layout()
    const requested: string[] = []
    const fetch = (async (url: string) => {
      requested.push(String(url))
      return new Response('', { status: 404 })
    }) as never
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, fetch, p)
    for (const version of ['0.3.9', '0.4.0-beta.1', '0.4.0-native.1']) {
      const res = await dispatch(call('update.install', { version }), handlers, ctx)
      expect(res).toMatchObject({ ok: false, error: { code: 'conflict' } })
    }
    expect(requested).toEqual([])
  })

  it('refuses a second update while the first is downloading', async () => {
    const { p } = layout()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetch = (async () => {
      await gate
      return new Response('', { status: 404 })
    }) as never
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, fetch, p)
    const first = dispatch(call('update.install', { version: '0.5.0' }), handlers, ctx)
    await Bun.sleep(10)
    expect(
      await dispatch(call('update.install', { version: '0.5.0' }), handlers, ctx),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(await dispatch(call('disk.prune-flytower', {}), handlers, ctx)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    release()
    expect(await first).toMatchObject({ ok: false, error: { code: 'failed' } })
    // Once it's over, the next one may go.
    expect(await dispatch(call('disk.prune-flytower', {}), handlers, ctx)).toMatchObject({
      ok: true,
    })
  })

  it('records the update as running before the updater starts, and hands it the folders', async () => {
    const { p } = layout()
    mkdirSync(join(p.prefix!, 'releases', '0.3.0', 'agent'), { recursive: true })
    writeFileSync(join(p.prefix!, 'releases', '0.3.0', 'VERSION'), '0.3.0')
    writeFileSync(join(p.prefix!, 'releases', '0.3.0', 'agent', 'updater.js'), '')
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, p)
    const res = await dispatch(call('update.rollback', { version: '0.3.0' }), handlers, ctx)
    expect(res).toMatchObject({ ok: true })
    expect(await readRecord(p.state)).toMatchObject({
      state: 'running',
      from: '0.4.0',
      to: '0.3.0',
      manual: true,
    })
    const run = calls.find((c) => c.file === 'systemd-run')!
    expect(run.args).toContain(`--setenv=FLYTOWER_AGENT_STATE_DIR=${p.state}`)
    expect(run.args).toContain(`--setenv=FLYTOWER_PANEL_DATA=${p.panelData}`)
    // A second request now sees the running record.
    expect(
      await dispatch(call('update.install', { version: '0.5.0' }), handlers, ctx),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })
})
