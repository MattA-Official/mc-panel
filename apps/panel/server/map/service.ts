/**
 * The web map: keeps each server's map up to date with `flytower-map`, which reads the
 * world's region files from outside the server and draws tiles into the maps folder.
 *
 * Nothing is polled. While a map is on, the server's folder is watched for region files
 * being saved; once saving has been quiet for a short while (or has gone on for a few
 * minutes), a pass redraws just the regions that changed. One pass runs at a time across
 * all servers, at low priority, so the Minecraft servers keep the machine.
 *
 * Colours come from the game's own client jar, made once per Minecraft version into a
 * palette. If that can't be fetched, the map is drawn with the built-in colours and the
 * next pass tries again.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MapSettings } from '../../shared/map-settings'
import { isSafeLevelName } from '../../shared/spec'
import { resolveInside } from '../files'

/** What the last pass did, summed over the world's dimensions. */
export interface MapPass {
  at: string
  ms: number
  full: boolean
  drawn: number
  unchanged: number
  removed: number
  chunks: number
  errors: number
  firstError: string | null
  /** Whether the game's colours were used, or the built-in ones. */
  colours: 'game' | 'built-in'
}

export interface MapStatus {
  enabled: boolean
  /** `waiting`: on, but the world hasn't been made yet. */
  state: 'off' | 'waiting' | 'queued' | 'drawing' | 'idle'
  lastPass: MapPass | null
  /** Why the last pass failed, if it did. */
  error: string | null
  /** How far the pass being drawn has got, in region files. Null when not drawing. */
  progress: MapProgress | null
}

export interface MapProgress {
  done: number
  total: number
}

export interface MapDeps {
  mapsDir: string
  serverDir: (name: string) => string
  /** Every server's name. */
  servers: () => string[]
  /** A server's map settings, or null if there's no such server. */
  settings: (name: string) => MapSettings | null
  minecraft: (name: string) => string | null
  levelName: (name: string) => Promise<string | null>
  /** Makes the palette for a Minecraft version at `dest`, from the client jar. */
  makePalette: (minecraft: string, dest: string) => Promise<void>
  /** Runs `flytower-map` with these arguments and returns what it prints, passing on any
   * progress it reports along the way. */
  run: (args: string[], onProgress?: (p: MapProgress) => void) => Promise<string>
  /** Tells anyone watching that a server's map status changed. */
  publish: (name: string, status: MapStatus) => void
  /** Calls `onSave` when a region file under `dir` changes. Returns a function to stop. */
  watch: (dir: string, onSave: () => void) => () => void
  /** How long saving must be quiet before a pass. */
  quietMs?: number
  /** The longest a pass waits while saving goes on. */
  maxWaitMs?: number
  /** The least time between progress updates sent to watchers. */
  progressMs?: number
}

interface Live {
  stop: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
  firstSave: number | null
  queued: { full: boolean } | null
  drawing: boolean
  progress: MapProgress | null
  progressSent: number
  waiting: boolean
  lastPass: MapPass | null
  error: string | null
  loaded: boolean
}

const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export class MapService {
  private live = new Map<string, Live>()
  private chain: Promise<void> = Promise.resolve()
  private palettes = new Map<string, Promise<string | null>>()

  constructor(private deps: MapDeps) {}

  /** The folder holding a server's map. */
  dir(name: string) {
    return join(this.deps.mapsDir, 'servers', name)
  }

  private state(name: string): Live {
    let s = this.live.get(name)
    if (!s) {
      s = {
        stop: null,
        timer: null,
        firstSave: null,
        queued: null,
        drawing: false,
        progress: null,
        progressSent: 0,
        waiting: false,
        lastPass: null,
        error: null,
        loaded: false,
      }
      this.live.set(name, s)
    }
    return s
  }

  /** Reads the last pass from disk once, so it survives a panel restart. */
  private async load(name: string, s: Live) {
    if (s.loaded) return
    s.loaded = true
    try {
      s.lastPass = JSON.parse(await readFile(join(this.dir(name), 'last-pass.json'), 'utf8'))
    } catch {
      s.lastPass = null
    }
  }

  async status(name: string): Promise<MapStatus> {
    const s = this.state(name)
    await this.load(name, s)
    return this.view(name, s)
  }

  private view(name: string, s: Live): MapStatus {
    const enabled = !!this.deps.settings(name)?.enabled
    const state = !enabled
      ? 'off'
      : s.drawing
        ? 'drawing'
        : s.queued || s.timer
          ? 'queued'
          : s.waiting
            ? 'waiting'
            : 'idle'
    const progress = state === 'drawing' ? s.progress : null
    return { enabled, state, lastPass: s.lastPass, error: s.error, progress }
  }

  private publish(name: string) {
    const s = this.live.get(name)
    if (s) this.deps.publish(name, this.view(name, s))
  }

  /** Starts every map that's on. Call once at boot. */
  async start() {
    await Promise.all(this.deps.servers().map((name) => this.sync(name)))
  }

  /** Stops watching everything. Passes already running finish. */
  stop() {
    for (const s of this.live.values()) {
      s.stop?.()
      s.stop = null
      if (s.timer) clearTimeout(s.timer)
      s.timer = null
    }
  }

  /**
   * Brings one server in line with its settings: watching and drawn when on, nothing on
   * disk when off.
   */
  async sync(name: string) {
    const s = this.state(name)
    await this.load(name, s)
    if (!this.deps.settings(name)?.enabled) {
      const had = s.stop || s.lastPass || existsSync(this.dir(name))
      this.halt(s)
      s.lastPass = null
      s.error = null
      s.waiting = false
      // A pass still running clears up after itself when it finishes.
      if (had && !s.drawing) await rm(this.dir(name), { recursive: true, force: true })
      this.publish(name)
      return
    }
    if (!s.stop) {
      s.stop = this.deps.watch(this.deps.serverDir(name), () => this.saved(name))
    }
    // A pass on start catches up on anything saved while the panel was down; it's quick
    // when nothing changed.
    this.draw(name)
  }

  /** A server is gone: stop and remove its map. */
  async forget(name: string) {
    const s = this.live.get(name)
    if (s) this.halt(s)
    this.live.delete(name)
    await rm(this.dir(name), { recursive: true, force: true })
  }

  private halt(s: Live) {
    s.stop?.()
    s.stop = null
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    s.firstSave = null
    s.queued = null
  }

  /** A region file was saved: draw once saving goes quiet, or has gone on long enough. */
  private saved(name: string) {
    const s = this.state(name)
    const now = Date.now()
    s.firstSave ??= now
    if (s.timer) clearTimeout(s.timer)
    const quiet = this.deps.quietMs ?? 30_000
    const maxWait = this.deps.maxWaitMs ?? 5 * 60_000
    const wait = Math.max(0, Math.min(quiet, s.firstSave + maxWait - now))
    const first = !s.timer
    s.timer = setTimeout(() => {
      s.timer = null
      s.firstSave = null
      this.draw(name)
    }, wait)
    if (first) this.publish(name)
  }

  /**
   * Queues a pass. `full` redraws every region, not just the ones that changed. Returns when
   * the pass has finished.
   */
  draw(name: string, opts: { full?: boolean } = {}): Promise<void> {
    const s = this.state(name)
    if (s.queued) {
      s.queued.full ||= !!opts.full
      return this.chain
    }
    s.queued = { full: !!opts.full }
    this.publish(name)
    this.chain = this.chain.then(() => this.pass(name)).catch(() => {})
    return this.chain
  }

  private async pass(name: string) {
    const s = this.state(name)
    const job = s.queued
    s.queued = null
    if (!job || !this.deps.settings(name)?.enabled) return this.publish(name)

    // The server can change its level-name and folders, so only a plain folder inside it is used.
    const level = (await this.deps.levelName(name)) || 'world'
    const world = isSafeLevelName(level)
      ? await resolveInside(this.deps.serverDir(name), level).catch(() => null)
      : null
    if (!world || !existsSync(world)) {
      s.waiting = true
      return this.publish(name)
    }
    s.waiting = false
    s.drawing = true
    this.publish(name)
    try {
      const palette = await this.palette(name)
      const out = this.dir(name)
      const args = ['render', '--world', world, '--out', out, '--progress']
      if (palette) args.push('--palette', palette)
      if (job.full) args.push('--full')
      const report = parseReport(
        await this.deps.run(args, (p) => {
          s.progress = p
          // Often enough to move smoothly, not once per region on a big world.
          const now = Date.now()
          if (p.done === p.total || now - s.progressSent >= (this.deps.progressMs ?? 500)) {
            s.progressSent = now
            this.publish(name)
          }
        }),
      )
      const pass: MapPass = { ...report, full: job.full, colours: palette ? 'game' : 'built-in' }
      await mkdir(out, { recursive: true })
      await writeFile(join(out, 'last-pass.json.tmp'), JSON.stringify(pass))
      await rename(join(out, 'last-pass.json.tmp'), join(out, 'last-pass.json'))
      s.lastPass = pass
      s.error = null
    } catch (err) {
      s.error = (err as Error).message
      console.error(`[flytower] map pass for ${name} failed`, err)
    } finally {
      s.drawing = false
      s.progress = null
      // Switched off while drawing: clear up what the pass wrote.
      if (!this.deps.settings(name)?.enabled) await this.sync(name)
      this.publish(name)
    }
  }

  /** The palette for this server's Minecraft version, made once and shared. */
  private async palette(name: string): Promise<string | null> {
    const mc = this.deps.minecraft(name)
    if (!mc || !SAFE_VERSION.test(mc)) return null
    const dest = join(this.deps.mapsDir, 'palettes', `${mc}.palette`)
    if (existsSync(dest)) return dest
    let making = this.palettes.get(mc)
    if (!making) {
      making = (async () => {
        try {
          await mkdir(join(this.deps.mapsDir, 'palettes'), { recursive: true })
          await this.deps.makePalette(mc, dest)
          return existsSync(dest) ? dest : null
        } catch (err) {
          console.error(`[flytower] couldn't make the map colours for ${mc}`, err)
          return null
        } finally {
          this.palettes.delete(mc)
        }
      })()
      this.palettes.set(mc, making)
    }
    return making
  }
}

/** A `progress DONE TOTAL` line from `flytower-map render --progress`, or null for any other. */
export function parseProgress(line: string): MapProgress | null {
  const m = line.trim().match(/^progress (\d+) (\d+)$/)
  if (!m) return null
  const done = Number(m[1])
  const total = Number(m[2])
  return done <= total ? { done, total } : null
}

/** Reads standard error as it comes: progress lines are passed on, the rest kept for errors. */
export async function readStderr(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (p: MapProgress) => void,
): Promise<string> {
  const kept: string[] = []
  const take = (line: string) => {
    const p = parseProgress(line)
    if (p) onProgress?.(p)
    else if (line.trim()) kept.push(line)
  }
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of stream) {
    rest += decoder.decode(chunk, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    lines.forEach(take)
  }
  take(rest + decoder.decode())
  return kept.join('\n')
}

/** Sums `flytower-map render`'s answer over dimensions. */
export function parseReport(out: string): Omit<MapPass, 'full' | 'colours'> {
  const parsed = JSON.parse(out) as {
    version?: number
    ms?: number
    dimensions?: {
      drawn: number
      unchanged: number
      removed: number
      chunks: number
      errors: number
      firstError: string | null
    }[]
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.dimensions)) {
    throw new Error("flytower-map's answer isn't one this panel understands")
  }
  const sum = { drawn: 0, unchanged: 0, removed: 0, chunks: 0, errors: 0 }
  let firstError: string | null = null
  for (const d of parsed.dimensions) {
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += Number(d[k]) || 0
    firstError ??= d.firstError ?? null
  }
  return { at: new Date().toISOString(), ms: Number(parsed.ms) || 0, ...sum, firstError }
}
