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
  /** The colour for in-game messages: the brand's accent, or `gold`. */
  colour?: string
}

export interface RestartTask {
  /** Seconds before the restart to warn, longest first. */
  warn: number[]
  skipWhenEmpty: boolean
}

/** Warnings with this many seconds or fewer go on screen as a title, too. */
const TITLE_SECONDS = 10

/** Flytower's gold, for in-game messages when the panel has no brand colour of its own. */
export const GOLD = 'gold'

/**
 * The console command that shows a line in everyone's chat, in the brand's colour (a named
 * colour or `#RRGGBB`, which every version Flytower runs understands).
 */
export function tellAll(text: string, colour = GOLD): string {
  return `tellraw @a ${JSON.stringify({ text, color: colour })}`
}

/** The console commands for one warning. */
export function warningCommands(seconds: number, colour = GOLD): string[] {
  const when = spokenDuration(seconds)
  const out = [tellAll(`Server restarting in ${when}`, colour)]
  if (seconds <= TITLE_SECONDS) {
    out.push(
      `title @a subtitle ${JSON.stringify({ text: `in ${when}`, color: colour })}`,
      `title @a title ${JSON.stringify({ text: 'Restarting', color: colour })}`,
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

/** The countdown was called off before the restart. */
export class RestartCancelled extends Error {
  override name = 'RestartCancelled'
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
  /** Calls off the countdown; once the restart itself has begun, it finishes. */
  signal?: AbortSignal,
): Promise<RestartOutcome> {
  const aborted = new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
  const wait = async (ms: number) => {
    if (ms > 0 && !signal?.aborted) await Promise.race([deps.sleep(ms), aborted])
    if (signal?.aborted) throw new RestartCancelled('Cancelled')
  }
  let empty = false
  if (task.skipWhenEmpty) {
    const online = await deps
      .rcon('list')
      .then(parseList)
      .catch(() => null)
    empty = online?.count === 0
  }
  let warned = 0
  try {
    if (!empty) {
      for (const w of warningTimeline(restartAt, task.warn, deps.now())) {
        await wait(w.at - deps.now())
        for (const cmd of warningCommands(w.seconds, deps.colour)) {
          // A warning that doesn't arrive is no reason to call off the restart.
          await deps.rcon(cmd).catch(() => {})
        }
        warned++
      }
      await wait(restartAt - deps.now())
    }
    await wait(0)
  } catch (err) {
    // Players who were told it's coming hear that it isn't.
    if (err instanceof RestartCancelled && warned) {
      await deps.rcon(tellAll('The restart has been called off', deps.colour)).catch(() => {})
    }
    throw err
  }
  const started = deps.now()
  // The stop saves too; this makes sure the world is on disk if the stop goes badly.
  await deps.rcon('save-all flush').catch(() => {})
  await deps.restart()
  return { warned, empty, tookSeconds: Math.round((deps.now() - started) / 1000) }
}
