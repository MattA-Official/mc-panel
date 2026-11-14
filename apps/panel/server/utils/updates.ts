import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { installedRuntimes, latestTemurin } from '../java-updates'
import { getSetting } from '../settings'
import { findMinecraftUpdate, UpdateChecker, type Summaries } from '../update-checks'
import { compareVersions, newestRelease, updateChannel } from '../updates'
import type { ContentUpdates, FlytowerUpdate } from '../../shared/updates'

let checker: UpdateChecker | undefined

function servers() {
  return useDb()
    .select({ name: schema.servers.name, javaMajor: schema.servers.javaMajor })
    .from(schema.servers)
    .all()
}

/** What's newer than what's running, on the chosen channel. */
export async function checkFlytower(force = true): Promise<FlytowerUpdate> {
  const status = await agent('update.status', {}).catch(() => null)
  const current = status?.current ?? useRuntimeConfig().version
  // Only what the System page would offer: betas only on the Beta channel.
  const { channel } = updateChannel(getSetting(useDb(), 'update.channel'), current)
  const newest = await newestRelease(channel, force)
  const newer = newest && compareVersions(newest.version, current) > 0 ? newest : null
  return {
    current,
    latest: newer && { version: newer.version, prerelease: newer.prerelease, url: newer.url },
  }
}

/** Newer compatible versions of a server's installed content. */
export async function checkContent(name: string): Promise<ContentUpdates> {
  const specs = useSpecs()
  const plan = await specs.plan(name, await specs.currentSpec(name), true)
  return {
    updates: plan.changes
      .filter((c) => c.action === 'update')
      .map((c) => ({ label: c.label, from: c.from, to: c.to })),
  }
}

/** A newer Minecraft, and the newest one everything installed is ready for. */
async function checkMinecraft(name: string) {
  const row = useDb()
    .select({ loader: schema.servers.loader, mcVersion: schema.servers.mcVersion })
    .from(schema.servers)
    .where(eq(schema.servers.name, name))
    .get()
  if (!row) throw new Error(`No server called ${name}`)
  const loader = useLoaders()[row.loader as keyof ReturnType<typeof useLoaders>]
  const versions = (await loader.minecraftVersions({ includeSnapshots: false })).map((v) => v.id)
  const specs = useSpecs()
  const spec = await specs.currentSpec(name)
  return findMinecraftUpdate(row.mcVersion, versions, async (minecraft) => {
    const plan = await specs.plan(name, { ...spec, loader: { type: spec.loader.type, minecraft } })
    return plan.problems
  })
}

/** Tells notification channels about new versions, once per new set of versions. */
function notifyFound<S extends keyof Summaries>(scope: S, subject: string, summary: Summaries[S]) {
  const notify = useNotify()
  if (scope === 'flytower' && notify.wants('update.flytower')) {
    const { current, latest } = summary as FlytowerUpdate
    notify.offer(
      {
        kind: 'update.flytower',
        title: latest
          ? `Flytower ${latest.version}${latest.prerelease ? ' (beta)' : ''} is out`
          : 'Flytower is up to date',
        detail: latest
          ? `You're on ${current}. Update from System, Updates, which takes a minute and keeps your servers running.`
          : undefined,
        severity: 'info',
        link: '/system/updates',
      },
      latest?.version ?? '',
    )
  }
  if (scope === 'content' && notify.wants('update.content')) {
    const { updates } = summary as ContentUpdates
    const lines = updates.map((u) => `${u.label}: ${u.from ?? '?'} → ${u.to ?? '?'}`)
    notify.offer(
      {
        kind: 'update.content',
        server: subject,
        title:
          updates.length === 1
            ? 'An update for installed content'
            : `${updates.length} updates for installed content`,
        detail:
          lines.slice(0, 10).join('\n') +
          (lines.length > 10 ? `\n…and ${lines.length - 10} more` : '') +
          '\n\nReview and apply them on the Content tab.',
        severity: 'info',
        link: `/servers/${subject}/content`,
      },
      [...lines].sort().join('\n'),
    )
  }
}

/** The one update checker for this process. */
export function useUpdates(): UpdateChecker {
  checker ??= new UpdateChecker({
    db: useDb(),
    sources: {
      flytower: () => checkFlytower(),
      content: checkContent,
      minecraft: checkMinecraft,
      runtimes: () => installedRuntimes(useRuntimeConfig().runtimesDir),
      latestJava: (major) => latestTemurin(major),
      servers,
    },
    found: notifyFound,
  })
  return checker
}
