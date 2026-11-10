import type { schema } from '../db'
import type { PublicPage, PublicStatus } from '../../shared/public-page'
import { publicStatus } from '../status/page'
import { withUuids } from '../players'
import { readLock } from '../spec/lock'

type Row = typeof schema.servers.$inferSelect

/**
 * A server's status as its public page shows it, built from the roster and the server's
 * files without asking the server. Used by the status page and Discord's /status.
 */
export async function buildPublicStatus(
  row: Row,
  page: PublicPage,
  machine: string,
): Promise<PublicStatus> {
  const name = row.name
  const service = (await useStatus().current())[name] ?? 'unknown'
  const roster = await useRoster().view(name, service === 'active')
  const props = await readProperties(name).catch(() => ({}) as Record<string, string>)
  const max = Number.parseInt(props['max-players'] ?? '', 10)
  const usercache = page.show.players === 'names' ? await readUserCache(name) : []
  const lock = await readLock(serverDir(name)).catch(() => null)
  // A pack built since the last change that turned out empty isn't offered.
  const hasPack =
    !!lock &&
    usePacks().peek(row, lock, page.pack.extras)?.path !== null &&
    (page.pack.extras.length > 0 ||
      lock.content.some((i) => i.kind === 'mod' && i.source === 'modrinth'))
  return publicStatus({
    row,
    page,
    service,
    roster,
    machine,
    motd: props.motd ?? '',
    hasPack,
    icon: iconUrl(name)?.replace(`/api/servers/${name}/`, `/api/public/servers/${name}/`) ?? null,
    maxPlayers: Number.isFinite(max) ? max : null,
    withUuids: (names) => withUuids(names, usercache),
    statsEnabled: statsSettings(name).enabled,
  })
}
