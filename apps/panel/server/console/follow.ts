import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * After each change, the log is read once more this long afterwards. Bun's file watcher can
 * fold a second change into the first when they come within about a millisecond, and
 * Minecraft writes "logged in" and "joined the game" that close together, so without the
 * second look the join would wait for whatever the server logs next.
 */
export const SETTLE_MS = 250

/**
 * Calls `changed` whenever a server's `logs/latest.log` changes, through inotify, so nothing
 * polls. Works for a server that has never run: the server's own folder is watched for the
 * logs folder to appear. Each change is followed by one more call SETTLE_MS later.
 * Returns a function that stops watching.
 */
export function watchServerLog(serverDir: string, changed: () => void): () => void {
  const logs = join(serverDir, 'logs')
  const watchers: FSWatcher[] = []
  let logsWatched = false
  let settle: ReturnType<typeof setTimeout> | null = null
  let closed = false
  // A watched folder that's deleted (the server is removed) reports an error; that's the end.
  const add = (w: FSWatcher) => watchers.push(w.on('error', () => {}))

  const fire = () => {
    if (closed) return
    changed()
    if (settle) clearTimeout(settle)
    settle = setTimeout(() => {
      settle = null
      if (!closed) changed()
    }, SETTLE_MS)
  }
  const watchLogs = () => {
    if (logsWatched) return
    try {
      add(
        watch(logs, (_event, file) => {
          if (!file || file === 'latest.log') fire()
        }),
      )
      logsWatched = true
    } catch {
      // No logs folder yet: the server has never run. The folder watch below sees it appear.
    }
  }
  try {
    add(
      watch(serverDir, (_event, file) => {
        if (file === 'logs') {
          watchLogs()
          fire()
        }
      }),
    )
  } catch (err) {
    console.error(`[flytower] can't watch ${serverDir} for its log`, err)
  }
  watchLogs()

  return () => {
    closed = true
    for (const w of watchers) w.close()
    if (settle) clearTimeout(settle)
  }
}
