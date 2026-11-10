import { join } from 'node:path'
import { CrashMonitor } from '../crashes/monitor'
import { schema } from '../db'

let monitor: CrashMonitor | undefined

/** The one crash monitor for this process. */
export function useCrashes(): CrashMonitor {
  monitor ??= new CrashMonitor({
    db: useDb(),
    serverDir: (name) => join(useRuntimeConfig().serversDir, name),
    notify: useNotify(),
    start: async (server) => void (await agent('service.start', { server })),
    onCrash: (server) => {
      useConsole().forget(server)
      useLogWatcher().crashed(server)
      void useSessions().crashed(server)
    },
    restart: async (server) => {
      useConsole().forget(server)
      // The not-responding alert already said it's being restarted; "Server restarted" follows.
      useLogWatcher().restartPressed(server, false)
      try {
        await agent('service.restart', { server }, { timeoutMs: 150_000 })
      } catch (err) {
        useLogWatcher().restartFailed(server)
        throw err
      }
    },
  })
  return monitor
}

/** Every server's crash condition and newest undismissed crash. */
export function serverHealth() {
  const names = useDb()
    .select({ name: schema.servers.name })
    .from(schema.servers)
    .all()
    .map((r) => r.name)
  return useCrashes().health(names)
}
