import { StatusWatcher } from '../jobs/status'
import { schema } from '../db'

let watcher: StatusWatcher | undefined

/** The one status watcher for this process. */
export function useStatus(): StatusWatcher {
  watcher ??= new StatusWatcher(agent, () =>
    useDb()
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .all()
      .map((r) => r.name),
  )
  return watcher
}
