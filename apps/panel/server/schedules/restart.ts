/**
 * A scheduled restart: warn players in-game at the chosen times, save, then restart the same
 * way the Restart button does (so it never counts as a crash).
 */
import { spokenDuration } from '../../shared/schedules'
import { parseList } from '../players'

export interface RestartDeps {
  rcon: (command: string) => Promise<string>
  /** The panel's normal restart; resolves once the server is running again. */
  restart: () => Promise<void>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export interface RestartTask {
  /** Seconds before the restart to warn, longest first. */
  warn: number[]
  skipWhenEmpty: boolean
}

/** Warnings with this many seconds or fewer go on screen as a title, too. */
const TITLE_SECONDS = 10

/** Flytower's gold, for in-game messages. */
export const GOLD = 'gold'

/** The console command that shows a line in everyone's chat, in Flytower's gold. */
export function tellAll(text: string): string {
  return `tellraw @a ${JSON.stringify({ text, color: GOLD })}`
}

/** The console commands for one warning. */
export function warningCommands(seconds: number): string[] {
  const when = spokenDuration(seconds)
  const out = [tellAll(`Server restarting in ${when}`)]
  if (seconds <= TITLE_SECONDS) {
    out.push(
      `title @a subtitle ${JSON.stringify({ text: `in ${when}`, color: GOLD })}`,
      `title @a title ${JSON.stringify({ text: 'Restarting', color: GOLD })}`,
    )
  }
  return out
}

/** When each warning goes out, for a restart at `restartAt`. Past ones are left out. */
export function warningTimeline(restartAt: number, warn: number[], now: number) {
  return [...warn]
    .sort((a, b) => b - a)
    .map((seconds) => ({ seconds, at: restartAt - seconds * 1000 }))
    .filter((w) => w.at >= now - 1000)
}

export interface RestartOutcome {
  /** How many warnings went out. */
  warned: number
  /** Nobody was online, so the countdown was skipped. */
  empty: boolean
  /** Seconds from saving to the server running again. */
  tookSeconds: number
}

/**
 * Runs the countdown and the restart, finishing at `restartAt` (or straight away when the
 * server is empty and that's allowed). Throws if the restart fails.
 */
export async function runRestart(
  deps: RestartDeps,
  task: RestartTask,
  restartAt: number,
): Promise<RestartOutcome> {
  let empty = false
  if (task.skipWhenEmpty) {
    const online = await deps
      .rcon('list')
      .then(parseList)
      .catch(() => null)
    empty = online?.count === 0
  }
  let warned = 0
  if (!empty) {
    for (const w of warningTimeline(restartAt, task.warn, deps.now())) {
      const wait = w.at - deps.now()
      if (wait > 0) await deps.sleep(wait)
      for (const cmd of warningCommands(w.seconds)) {
        // A warning that doesn't arrive is no reason to call off the restart.
        await deps.rcon(cmd).catch(() => {})
      }
      warned++
    }
    const wait = restartAt - deps.now()
    if (wait > 0) await deps.sleep(wait)
  }
  const started = deps.now()
  // The stop saves too; this makes sure the world is on disk if the stop goes badly.
  await deps.rcon('save-all flush').catch(() => {})
  await deps.restart()
  return { warned, empty, tookSeconds: Math.round((deps.now() - started) / 1000) }
}
