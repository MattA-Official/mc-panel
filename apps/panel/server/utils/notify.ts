import { deriveSecret } from 'nuxt/server'
import { eq } from 'drizzle-orm'
import { sealer } from '../backups/offsite'
import { schema } from '../db'
import { NotifyError, NotifyService } from '../notify'
import { LogWatcher } from '../notify/watchers'
import type { MachineReading } from '../metrics/sampler'
import { compareVersions, defaultChannel, newestRelease } from '../updates'
import { getSetting } from '../settings'

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
  logs ??= new LogWatcher(useNotify(), useRuntimeConfig().serversDir)
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

/** Looks for a newer Flytower and for content updates, telling people once per new version. */
export async function checkUpdatesForNotify() {
  const notify = useNotify()
  if (notify.wants('update.flytower')) {
    try {
      const status = await agent('update.status', {}).catch(() => null)
      const current = status?.current ?? useRuntimeConfig().version
      // Only what the System page would offer: betas only on the Beta channel.
      const channel = getSetting(useDb(), 'update.channel') ?? defaultChannel(current)
      const newest = await newestRelease(channel, true)
      const newer = newest && compareVersions(newest.version, current) > 0 ? newest : null
      notify.offer(
        {
          kind: 'update.flytower',
          title: newer
            ? `Flytower ${newer.version}${newer.prerelease ? ' (beta)' : ''} is out`
            : 'Flytower is up to date',
          detail: newer
            ? `You're on ${current}. Update from System, Flytower, which takes a minute and keeps your servers running.`
            : undefined,
          severity: 'info',
          link: '/system',
        },
        newer?.version ?? '',
      )
    } catch (err) {
      console.error('[flytower] checking for a newer Flytower failed', err)
    }
  }
  if (notify.wants('update.content')) {
    const specs = useSpecs()
    for (const name of serverNames()) {
      try {
        const plan = await specs.plan(name, await specs.currentSpec(name), true)
        const updates = plan.changes.filter((c) => c.action === 'update')
        const lines = updates.map((u) => `${u.label}: ${u.from ?? '?'} → ${u.to ?? '?'}`)
        notify.offer(
          {
            kind: 'update.content',
            server: name,
            title:
              updates.length === 1
                ? 'An update for installed content'
                : `${updates.length} updates for installed content`,
            detail:
              lines.slice(0, 10).join('\n') +
              (lines.length > 10 ? `\n…and ${lines.length - 10} more` : '') +
              '\n\nReview and apply them on the Content tab.',
            severity: 'info',
            link: `/servers/${name}/content`,
          },
          lines.sort().join('\n'),
        )
      } catch (err) {
        console.error(`[flytower] checking content updates for ${name} failed`, err)
      }
    }
  }
}
