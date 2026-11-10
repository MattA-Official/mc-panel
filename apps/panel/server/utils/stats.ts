import { offlineUuid } from '@flytower/providers'
import { Sessions } from '../stats/sessions'
import { parseList } from '../players'
import { schema } from '../db'

let sessions: Sessions | undefined

/** Player sessions for every server, from the log. */
export function useSessions(): Sessions {
  if (!sessions) {
    const s = new Sessions({
      db: useDb(),
      lookupUuid: async (server, name) => {
        const cache = await readUserCache(server)
        if (Array.isArray(cache)) {
          const lower = name.toLowerCase()
          for (const e of cache as { name?: unknown; uuid?: unknown }[]) {
            if (typeof e?.name === 'string' && typeof e.uuid === 'string')
              if (e.name.toLowerCase() === lower) return e.uuid.toLowerCase()
          }
        }
        // An offline-mode server gives every name a fixed UUID, so it can be worked out here.
        const props = await readProperties(server).catch(() => ({}) as Record<string, string>)
        return props['online-mode'] === 'false' ? offlineUuid(name) : null
      },
    })
    const logs = useLogWatcher()
    logs.listenLines((server, line) => s.line(server, line))
    logs.listen((server, e) => void s.observe(server, e))
    sessions = s
  }
  return sessions
}

/**
 * Once, when the panel starts: lines up the sessions left open with who is actually on, since
 * players may have come and gone while the panel was down.
 */
export async function reconcileSessions() {
  const s = useSessions()
  const status = await useStatus()
    .current()
    .catch(() => null)
  // Without knowing what's running, leave the sessions as they are.
  if (!status) return
  const names = useDb()
    .select({ name: schema.servers.name })
    .from(schema.servers)
    .all()
    .map((r) => r.name)
  await Promise.all(
    names.map(async (server) => {
      let online: string[] | null = null
      if (status[server] === 'active') {
        online = await useConsole()
          .command(server, 'list', { echo: false })
          .then((reply) => parseList(reply)?.names ?? null)
          .catch(() => null)
      }
      await s.reconcile(server, online)
    }),
  )
}
