/**
 * The metrics history: once a minute, each running server's CPU, memory, players and tick
 * time, and the machine's CPU, memory and disk. Kept for a week. Stopped servers write
 * nothing, so their charts show gaps rather than zeros.
 */
import { readFile, statfs } from 'node:fs/promises'
import { cpus } from 'node:os'
import { and, gte, lt, sql } from 'drizzle-orm'
import { schema, type Db } from '../db'
import type { Result } from '@flytower/protocol'
import type { AgentCall } from '../jobs/runner'
import { parseList } from '../players'

export const MACHINE = '*'
export const KEEP_SECONDS = 7 * 24 * 3600

export interface MachineReading {
  /** Cumulative CPU time, busy and total, in any unit (jiffies from /proc/stat). */
  cpuBusy: number
  cpuTotal: number
  memUsedMb: number
  memTotalMb: number
  diskUsedMb: number | null
  diskTotalMb: number | null
}

export interface MetricsDeps {
  db: Db
  agent: AgentCall
  names: () => string[]
  /** Runs a console command quietly and returns the reply. */
  rcon: (server: string, command: string) => Promise<string>
  machine: () => Promise<MachineReading>
  cores?: number
  now?: () => Date
  /**
   * Called after each sample with which servers are running (servers the agent didn't answer
   * for are left out) and the machine's reading, for notifications.
   */
  onSample?: (sample: { active: Record<string, boolean>; machine: MachineReading | null }) => void
}

/** "Average time per tick: 3.2ms" from `tick query`, in milliseconds. */
export function parseTickQuery(reply: string): number | null {
  const m = reply.match(/Average time per tick:\s*([\d.,]+)\s*ms/i)
  if (!m) return null
  const ms = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(ms) ? ms : null
}

/** The busy and total CPU time from the first line of /proc/stat. */
export function parseProcStat(text: string): { busy: number; total: number } | null {
  const line = text.split('\n').find((l) => l.startsWith('cpu '))
  if (!line) return null
  const n = line.trim().split(/\s+/).slice(1, 9).map(Number)
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return null
  const total = n.reduce((a, b) => a + b, 0)
  const idle = n[3]! + (n[4] ?? 0) // idle + iowait
  return { busy: total - idle, total }
}

/** Used and total memory from /proc/meminfo, in MB. */
export function parseMeminfo(text: string): { usedMb: number; totalMb: number } | null {
  const kb = (key: string) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'))
    return m ? Number(m[1]) : null
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  if (total === null || available === null) return null
  return { usedMb: Math.round((total - available) / 1024), totalMb: Math.round(total / 1024) }
}

/** Reads the machine's figures from /proc and the disk holding `dir`. */
export async function readMachine(dir: string): Promise<MachineReading> {
  const [stat, mem, disk] = await Promise.all([
    readFile('/proc/stat', 'utf8').then(parseProcStat, () => null),
    readFile('/proc/meminfo', 'utf8').then(parseMeminfo, () => null),
    statfs(dir).catch(() => null),
  ])
  const mb = (blocks: number, size: number) => Math.round((blocks * size) / 1024 / 1024)
  return {
    cpuBusy: stat?.busy ?? 0,
    cpuTotal: stat?.total ?? 0,
    memUsedMb: mem?.usedMb ?? 0,
    memTotalMb: mem?.totalMb ?? 0,
    diskUsedMb: disk ? mb(disk.blocks - disk.bfree, disk.bsize) : null,
    diskTotalMb: disk ? mb(disk.blocks, disk.bsize) : null,
  }
}

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places

export class MetricsSampler {
  private cores: number
  private now: () => Date
  private prevServer = new Map<string, { cpuNs: number; at: number }>()
  private prevMachine: { busy: number; total: number } | null = null
  private lastPrune = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  /** The latest machine reading, for chart scales. */
  latest: MachineReading | null = null

  constructor(private deps: MetricsDeps) {
    this.cores = deps.cores ?? Math.max(1, cpus().length)
    this.now = deps.now ?? (() => new Date())
  }

  /** Samples now, then on every minute. */
  start() {
    if (this.timer) return
    const tick = () => {
      void this.sample().catch((err) => console.error('[flytower] metrics sample failed', err))
      const ms = this.now().getTime()
      this.timer = setTimeout(tick, 60_000 - (ms % 60_000) + 500)
    }
    tick()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Takes one sample and writes it. Returns the rows written. */
  async sample(): Promise<number> {
    if (this.busy) return 0
    this.busy = true
    try {
      return await this.take()
    } finally {
      this.busy = false
    }
  }

  private async take(): Promise<number> {
    const nowMs = this.now().getTime()
    const at = Math.floor(nowMs / 60_000) * 60
    const names = this.deps.names()
    const rows: (typeof schema.metrics.$inferInsert)[] = []

    const [usage, machine] = await Promise.all([
      names.length
        ? this.deps
            .agent('service.usage', { servers: names }, { timeoutMs: 10_000 })
            .then((r) => r.usage)
            .catch((): Result<'service.usage'>['usage'] => ({}))
        : Promise.resolve<Result<'service.usage'>['usage']>({}),
      this.deps.machine().catch(() => null),
    ])

    await Promise.all(
      Object.entries(usage).map(async ([server, u]) => {
        if (!u.active) {
          this.prevServer.delete(server)
          return
        }
        let cpu: number | null = null
        const prev = this.prevServer.get(server)
        if (u.cpuNs !== null) {
          if (prev && u.cpuNs >= prev.cpuNs && nowMs > prev.at) {
            const pct = ((u.cpuNs - prev.cpuNs) / ((nowMs - prev.at) * 1e6 * this.cores)) * 100
            cpu = round(Math.min(100, Math.max(0, pct)))
          }
          this.prevServer.set(server, { cpuNs: u.cpuNs, at: nowMs })
        }
        const [list, tick] = await Promise.all([
          this.deps.rcon(server, 'list').catch(() => ''),
          this.deps.rcon(server, 'tick query').catch(() => ''),
        ])
        const mspt = parseTickQuery(tick)
        rows.push({
          server,
          at,
          cpu,
          memMb: u.memoryBytes === null ? null : Math.round(u.memoryBytes / 1024 / 1024),
          players: parseList(list)?.count ?? null,
          mspt: mspt === null ? null : round(mspt, 2),
        })
      }),
    )

    if (machine) {
      this.latest = machine
      let cpu: number | null = null
      const prev = this.prevMachine
      if (prev && machine.cpuTotal > prev.total && machine.cpuBusy >= prev.busy) {
        cpu = round(((machine.cpuBusy - prev.busy) / (machine.cpuTotal - prev.total)) * 100)
      }
      this.prevMachine = { busy: machine.cpuBusy, total: machine.cpuTotal }
      rows.push({
        server: MACHINE,
        at,
        cpu,
        memMb: machine.memUsedMb,
        diskMb: machine.diskUsedMb,
      })
    }

    if (rows.length) {
      this.deps.db.insert(schema.metrics).values(rows).onConflictDoNothing().run()
    }
    try {
      this.deps.onSample?.({
        active: Object.fromEntries(Object.entries(usage).map(([s, u]) => [s, u.active])),
        machine,
      })
    } catch (err) {
      console.error('[flytower] after-sample hook failed', err)
    }
    if (nowMs - this.lastPrune > 3600_000) {
      this.lastPrune = nowMs
      this.prune(at)
    }
    return rows.length
  }

  /** Drops samples older than a week. */
  prune(at: number) {
    this.deps.db
      .delete(schema.metrics)
      .where(lt(schema.metrics.at, at - KEEP_SECONDS))
      .run()
  }
}

export const RANGES = {
  hour: { seconds: 3600, step: 60 },
  day: { seconds: 24 * 3600, step: 5 * 60 },
  week: { seconds: KEEP_SECONDS, step: 30 * 60 },
} as const
export type Range = keyof typeof RANGES

export interface Point {
  at: number
  cpu: number | null
  memMb: number | null
  players: number | null
  mspt: number | null
  diskMb: number | null
}

/**
 * A server's (or the machine's) history over a range, one point per step, oldest first.
 * Steps with no samples are all nulls, which the charts draw as gaps. CPU, memory, tick
 * time and disk are averaged over each step; players is the most online at once.
 */
export function series(db: Db, server: string, range: Range, nowMs: number) {
  const { seconds, step } = RANGES[range]
  const end = Math.floor(nowMs / 1000 / step) * step
  const from = end - seconds + step
  const m = schema.metrics
  const bucket = sql<number>`(${m.at} / ${step}) * ${step}`
  const rows = db
    .select({
      at: bucket,
      cpu: sql<number | null>`avg(${m.cpu})`,
      memMb: sql<number | null>`avg(${m.memMb})`,
      players: sql<number | null>`max(${m.players})`,
      mspt: sql<number | null>`avg(${m.mspt})`,
      diskMb: sql<number | null>`avg(${m.diskMb})`,
    })
    .from(m)
    .where(and(sql`${m.server} = ${server}`, gte(m.at, from)))
    .groupBy(bucket)
    .all()
  const byAt = new Map(rows.map((r) => [r.at, r]))
  const points: Point[] = []
  for (let at = from; at <= end; at += step) {
    const r = byAt.get(at)
    points.push({
      at,
      cpu: r?.cpu == null ? null : round(r.cpu),
      memMb: r?.memMb == null ? null : Math.round(r.memMb),
      players: r?.players ?? null,
      mspt: r?.mspt == null ? null : round(r.mspt, 2),
      diskMb: r?.diskMb == null ? null : Math.round(r.diskMb),
    })
  }
  return { range, step, points }
}

/** Forgets a deleted server's history. */
export function forgetMetrics(db: Db, server: string) {
  db.delete(schema.metrics)
    .where(sql`${schema.metrics.server} = ${server}`)
    .run()
}
