import { generateKeyPairSync, sign } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
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
    expect(readFileSync(join(p.panelData!, 'flytower.db.before-0.5.0'), 'utf8')).toBe(
      'old database',
    )
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
