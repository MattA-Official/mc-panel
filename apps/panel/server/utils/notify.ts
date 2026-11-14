import { deriveSecret } from 'nuxt/server'
import { eq } from 'drizzle-orm'
import { sealer } from '../backups/offsite'
import { schema } from '../db'
import { NotifyError, NotifyService } from '../notify'
import { LogWatcher } from '../notify/watchers'
import type { MachineReading } from '../metrics/sampler'

let service: NotifyService | undefined

/** The one notifier for this process. */
export function useNotify(): NotifyService {
  if (service) return service
  const seal = sealer(() => deriveSecret('flytower:notify-channels'))
  service = new NotifyService({
    db: useDb(),
    seal: seal.seal,
    unseal: seal.unseal,
    origin: () => {
      const { rpId } = useRuntimeConfig()
      return rpId ? `https://${rpId}` : null
    },
    displayName: (name) =>
      useDb()
        .select({ displayName: schema.servers.displayName })
        .from(schema.servers)
        .where(eq(schema.servers.name, name))
        .get()?.displayName ?? null,
    brand: () => {
      const b = useBranding()
      const logo = b.image('logo')
      return {
        name: b.settings().name,
        pngLogo: logo?.type === 'image/png' ? `/branding/logo?v=${logo.hash}` : null,
      }
    },
  })
  return service
}

/** Runs `fn`, turning a NotifyError into a 400 (or 404 for a missing channel). */
export async function notifyHttp<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof NotifyError) {
      const missing = err.message.startsWith('No such')
      throw createError({ statusCode: missing ? 404 : 400, statusMessage: err.message })
    }
    throw err
  }
}

let logs: LogWatcher | undefined

function serverNames() {
  return useDb()
    .select({ name: schema.servers.name })
    .from(schema.servers)
    .all()
    .map((r) => r.name)
}

/** Follows every server's log for starts, stops, restarts, joins and leaves. */
export function useLogWatcher(): LogWatcher {
  logs ??= new LogWatcher(useNotify(), useRuntimeConfig().serversDir, Date.now, useLogStreams())
  return logs
}

/** Follows new servers' logs and lets go of deleted ones. */
export function syncLogWatcher() {
  useLogWatcher().sync(serverNames())
}

/**
 * Runs after each metrics sample: the disk filling up, following any new server's log, and
 * whether each running server's console answered (for crash detection's not-responding).
 */
export function afterSample(sample: {
  machine: MachineReading | null
  answered: Record<string, boolean>
}) {
  const notify = useNotify()
  if (Object.keys(sample.answered).length) {
    const restartWhenUnresponsive = new Map(
      useDb()
        .select({ name: schema.servers.name, on: schema.servers.restartWhenUnresponsive })
        .from(schema.servers)
        .all()
        .map((r) => [r.name, r.on]),
    )
    const crashes = useCrashes()
    for (const [server, ok] of Object.entries(sample.answered)) {
      void crashes.answered(server, ok, restartWhenUnresponsive.get(server) ?? false)
    }
  }
  const m = sample.machine
  if (m?.diskUsedMb != null && m.diskTotalMb && notify.wants('disk.full')) {
    notify.disk(m.diskUsedMb, m.diskTotalMb)
  }
  syncLogWatcher()
}

/** Forgets a deleted server everywhere notifications remember it. */
export function forgetNotifyServer(name: string) {
  useNotify().forgetServer(name)
  useCrashes().forget(name)
  syncLogWatcher()
}
