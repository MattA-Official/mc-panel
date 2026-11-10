import { existsSync } from 'node:fs'
import { mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'
import { sumFor, verifySums } from '../release.ts'
import { currentVersion, readRecord } from '../updater.ts'
import { downloadVerified } from '../download.ts'
import { hasUpdater, setAgentExecStart, updaterCommand } from '../entry-points.ts'

const RELEASES = 'https://github.com/MattA-Official/mc-panel/releases/download'
const prefixOf = (ctx: AgentContext) => ctx.paths.prefix ?? '/opt/flytower'
const archOf = (ctx: AgentContext) => (ctx.arch === 'arm64' ? 'arm64' : 'amd64')

async function installed(ctx: AgentContext): Promise<string[]> {
  const dir = join(prefixOf(ctx), 'releases')
  const names = await readdir(dir).catch(() => [] as string[])
  return names.filter((n) => existsSync(join(dir, n, 'VERSION'))).sort()
}

export async function status(
  _p: Params<'update.status'>,
  ctx: AgentContext,
): Promise<Result<'update.status'>> {
  return {
    current: await currentVersion(prefixOf(ctx)).catch(() => ctx.version),
    releases: await installed(ctx),
    last: await readRecord(ctx.paths.state),
  }
}

async function busy(ctx: AgentContext) {
  const r = await readRecord(ctx.paths.state)
  // A record left "running" for over 10 minutes is from an updater that died.
  if (r?.state === 'running' && Date.now() - Date.parse(r.at) < 10 * 60_000) {
    throw new AgentError('conflict', 'an update is already running')
  }
}

/**
 * Hands over to the new release's updater, in its own unit so it survives our restart. The
 * agent unit is pointed at that release's entry point first, because an updater from before
 * the wrappers existed doesn't know to do it.
 */
async function startUpdater(ctx: AgentContext, version: string, manual: boolean) {
  const release = join(prefixOf(ctx), 'releases', version)
  await setAgentExecStart(ctx.paths.systemd, prefixOf(ctx), release)
  const unit = `flytower-update-${version.replace(/[^0-9a-z]/gi, '-')}-${Date.now()}`
  const r = await ctx.exec('systemd-run', [
    `--unit=${unit}`,
    '--collect',
    '--quiet',
    ...[
      'FLYTOWER_PREFIX',
      'FLYTOWER_PANEL_DATA',
      'FLYTOWER_CONFIG_DIR',
      'FLYTOWER_SYSTEMD_DIR',
      'FLYTOWER_AGENT_STATE_DIR',
    ]
      .filter((k) => process.env[k])
      .map((k) => `--setenv=${k}=${process.env[k]}`),
    ...updaterCommand(release),
    version,
    ...(manual ? ['--manual'] : []),
  ])
  if (r.code !== 0) throw new AgentError('failed', `couldn't start the updater: ${r.stderr.trim()}`)
}

export async function install(
  p: Params<'update.install'>,
  ctx: AgentContext,
): Promise<Result<'update.install'>> {
  await busy(ctx)
  const prefix = prefixOf(ctx)
  if ((await currentVersion(prefix).catch(() => ctx.version)) === p.version) {
    throw new AgentError('conflict', `${p.version} is already running`)
  }
  // Native builds (docs/decisions/0001-rust-and-go.md) have their own tags, which panels from
  // before the Native channel never look at.
  const tag = /-(.+\.)?native\.\d+$/.test(p.version) ? `native-${p.version}` : `v${p.version}`
  const base = `${ctx.releasesUrl ?? RELEASES}/${tag}`
  const name = `flytower-${p.version}-linux-${archOf(ctx)}.tar.gz`
  const work = join(prefix, 'releases', `.download-${p.version}`)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  try {
    const get = async (file: string) => {
      const res = await ctx.fetch(`${base}/${file}`)
      if (!res.ok)
        throw new AgentError('failed', `${file} wasn't found for ${p.version} (${res.status})`)
      return res.text()
    }
    const sums = await get('SHA256SUMS')
    const sig = await get('SHA256SUMS.sig')
    if (!verifySums(sums, sig, ctx.releaseKey)) {
      throw new AgentError(
        'failed',
        `${p.version}'s signature doesn't match Flytower's key; not installing it`,
      )
    }
    const sha = sumFor(sums, name)
    if (!sha) throw new AgentError('failed', `${p.version} has no build for this machine (${name})`)
    await downloadVerified(ctx.fetch, `${base}/${name}`, join(work, name), sha)

    await mkdir(join(work, 'unpack'))
    const tar = await ctx.exec('tar', ['-xzf', join(work, name), '-C', join(work, 'unpack')])
    if (tar.code !== 0) throw new AgentError('failed', `unpacking failed: ${tar.stderr.trim()}`)
    const root = join(work, 'unpack', `flytower-${p.version}`)
    if (!existsSync(join(root, 'VERSION')) || !hasUpdater(root)) {
      throw new AgentError('failed', `${name} isn't a Flytower release this agent can install`)
    }
    const dest = join(prefix, 'releases', p.version)
    await rm(dest, { recursive: true, force: true })
    await rename(root, dest)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  await startUpdater(ctx, p.version, false)
  return { started: true }
}

export async function rollback(
  p: Params<'update.rollback'>,
  ctx: AgentContext,
): Promise<Result<'update.rollback'>> {
  await busy(ctx)
  if (!(await installed(ctx)).includes(p.version)) {
    throw new AgentError('not_found', `${p.version} isn't installed`)
  }
  if ((await currentVersion(prefixOf(ctx)).catch(() => ctx.version)) === p.version) {
    throw new AgentError('conflict', `${p.version} is already running`)
  }
  await startUpdater(ctx, p.version, true)
  return { started: true }
}

/**
 * Points the agent's own unit at the running release's entry point when the agent starts, so
 * installs from before the wrappers existed move over on their first update. Takes effect
 * from the agent's next restart; nothing is restarted here.
 */
export async function refreshAgentUnit(ctx: AgentContext): Promise<boolean> {
  const prefix = prefixOf(ctx)
  const release = await realpath(join(prefix, 'current')).catch(() => null)
  if (!release || !(await setAgentExecStart(ctx.paths.systemd, prefix, release))) return false
  const r = await ctx.exec('systemctl', ['daemon-reload'])
  if (r.code !== 0) throw new Error(`systemctl daemon-reload: ${r.stderr.trim() || 'failed'}`)
  return true
}
