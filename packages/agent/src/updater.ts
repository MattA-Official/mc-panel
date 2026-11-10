/**
 * Switching Flytower to another installed release, and back again if it isn't healthy.
 * Runs as its own transient systemd unit, because it restarts the agent that started it.
 */
import {
  chmod,
  chown,
  cp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setAgentExecStart } from './entry-points.ts'
import type { Exec } from './exec.ts'

export interface UpdateRecord {
  state: 'running' | 'succeeded' | 'rolled-back' | 'failed'
  from: string
  to: string
  reason: string | null
  at: string
  manual: boolean
}

export interface UpdaterDeps {
  prefix: string // /opt/flytower
  panelData: string // /var/lib/flytower
  config: string // /etc/flytower
  systemd: string // /etc/systemd/system
  state: string // /var/lib/flytower/agent
  exec: Exec
  /** Resolves to the panel's /api/health body, or throws. */
  health: (port: number) => Promise<{ version: string; agent: { ok: boolean } }>
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  healthTimeoutMs?: number
}

export const recordPath = (state: string) => join(state, 'update.json')

export async function readRecord(state: string): Promise<UpdateRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(state), 'utf8')) as UpdateRecord
  } catch {
    return null
  }
}

/** The version `current` points at. */
export async function currentVersion(prefix: string): Promise<string> {
  const target = await readlink(join(prefix, 'current'))
  return target.split('/').filter(Boolean).at(-1)!
}

const DB_FILES = ['flytower.db', 'flytower.db-wal', 'flytower.db-shm']

async function pointAt(prefix: string, version: string) {
  const tmp = join(prefix, 'current.new')
  await rm(tmp, { force: true })
  await symlink(join(prefix, 'releases', version), tmp)
  await rename(tmp, join(prefix, 'current'))
}

/**
 * Rewrites the version lines the installer wrote, so health checks see the right one, and
 * points the agent unit at the release's entry point (see entry-points.ts).
 */
async function setVersion(d: UpdaterDeps, version: string) {
  const env = join(d.config, 'panel.env')
  await writeFile(
    env,
    (await readFile(env, 'utf8')).replace(/^NUXT_VERSION=.*$/m, `NUXT_VERSION=${version}`),
  )
  const unit = join(d.systemd, 'flytower-agent.service')
  await writeFile(
    unit,
    (await readFile(unit, 'utf8')).replace(
      /^Environment=FLYTOWER_VERSION=.*$/m,
      `Environment=FLYTOWER_VERSION=${version}`,
    ),
  )
  await setAgentExecStart(d.systemd, d.prefix, join(d.prefix, 'releases', version))
}

async function panelPort(config: string) {
  const env = await readFile(join(config, 'panel.env'), 'utf8')
  return Number(/^PORT=(\d+)$/m.exec(env)?.[1] ?? 3000)
}

async function run(exec: Exec, file: string, args: string[]) {
  const r = await exec(file, args)
  if (r.code !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr.trim() || 'failed'}`)
}

async function switchTo(d: UpdaterDeps, version: string) {
  await run(d.exec, 'systemctl', ['stop', 'flytower-panel.service'])
  await pointAt(d.prefix, version)
  await setVersion(d, version)
  await run(d.exec, 'systemctl', ['daemon-reload'])
  await run(d.exec, 'systemctl', ['restart', 'flytower-agent.service'])
  await run(d.exec, 'systemctl', ['start', 'flytower-panel.service'])
}

async function healthy(d: UpdaterDeps, version: string): Promise<string | null> {
  const sleep = d.sleep ?? ((ms: number) => Bun.sleep(ms))
  const port = await panelPort(d.config)
  const deadline = Date.now() + (d.healthTimeoutMs ?? 120_000)
  let last: string
  for (;;) {
    try {
      const h = await d.health(port)
      if (h.version === version && h.agent.ok) return null
      last =
        h.version !== version ? `the panel reported ${h.version}` : 'the system helper was down'
    } catch (err) {
      last = `the panel didn't answer (${(err as Error).message})`
    }
    if (Date.now() > deadline) return last
    await sleep(2000)
  }
}

/**
 * Moves from the current release to `to`. The database is copied first (with the panel
 * stopped, so the copy is consistent) and put back if the new version isn't healthy.
 */
export async function runUpdate(d: UpdaterDeps, to: string, manual = false): Promise<UpdateRecord> {
  const now = () => (d.now?.() ?? new Date()).toISOString()
  const from = await currentVersion(d.prefix)
  const write = async (r: UpdateRecord) => {
    await writeFile(recordPath(d.state), JSON.stringify(r, null, 2))
    return r
  }
  const record: UpdateRecord = { state: 'running', from, to, reason: null, at: now(), manual }
  await write(record)
  if (!existsSync(join(d.prefix, 'releases', to, 'VERSION'))) {
    return write({ ...record, state: 'failed', reason: `release ${to} isn't installed` })
  }

  const saved: Saved[] = []
  try {
    await run(d.exec, 'systemctl', ['stop', 'flytower-panel.service'])
    for (const f of DB_FILES) {
      const src = join(d.panelData, f)
      if (!existsSync(src)) continue
      const { uid, gid, mode } = await stat(src)
      await cp(src, join(d.panelData, `${f}.before-${to}`), { preserveTimestamps: true })
      saved.push({ file: f, uid, gid, mode })
    }
    await switchTo(d, to)
    const problem = await healthy(d, to)
    if (!problem) {
      await prune(d.prefix, [to, from])
      return write({ ...record, state: 'succeeded', at: now() })
    }
    await rollBack(d, from, to, saved)
    return write({ ...record, state: 'rolled-back', reason: problem, at: now() })
  } catch (err) {
    await rollBack(d, from, to, saved).catch(() => {})
    return write({ ...record, state: 'rolled-back', reason: (err as Error).message, at: now() })
  }
}

/** A database file as it was before the update, and who owned it. */
interface Saved {
  file: string
  uid: number
  gid: number
  mode: number
}

async function rollBack(d: UpdaterDeps, from: string, to: string, saved: Saved[]) {
  await d.exec('systemctl', ['stop', 'flytower-panel.service'])
  for (const f of DB_FILES) {
    const was = saved.find((s) => s.file === f)
    const dest = join(d.panelData, f)
    if (!was) {
      await rm(dest, { force: true })
      continue
    }
    // The updater runs as root, so a restored file must go back to the panel's user, or
    // SQLite can't open it (a root-owned -shm file stops the panel starting at all).
    await rm(dest, { force: true })
    await cp(join(d.panelData, `${f}.before-${to}`), dest, { preserveTimestamps: true })
    await chown(dest, was.uid, was.gid)
    await chmod(dest, was.mode & 0o7777)
  }
  await switchTo(d, from)
}

/** Keeps only the releases named; runtimes and everything else stay. */
async function prune(prefix: string, keep: string[]) {
  for (const name of await readdir(join(prefix, 'releases'))) {
    if (!keep.includes(name))
      await rm(join(prefix, 'releases', name), { recursive: true, force: true })
  }
}
