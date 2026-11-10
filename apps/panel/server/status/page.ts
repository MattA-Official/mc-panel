/**
 * What a server's public status page shows, built only from what its settings allow. Pure,
 * so the rules for what leaves the panel are tested in one place.
 */
import type { PublicPage, PublicStatus } from '../../shared/public-page'
import type { RosterView } from './roster'

const LOADERS: Record<string, string> = { vanilla: 'Vanilla', fabric: 'Fabric', paper: 'Paper' }

export interface PageInput {
  row: {
    name: string
    displayName: string
    loader: string
    mcVersion: string
    hostname: string | null
    port: number
  }
  page: PublicPage
  /** systemd's state for the server. */
  service: string
  roster: RosterView
  /** The host the visitor reached the panel on, for servers without their own hostname. */
  machine: string
  /** `max-players` from server.properties, when it's a number. */
  maxPlayers: number | null
  withUuids: (names: string[]) => { name: string; uuid: string }[]
}

export function joinAddress(row: PageInput['row'], machine: string): string {
  if (row.hostname) return row.hostname
  return row.port === 25565 ? machine : `${machine}:${row.port}`
}

export function publicStatus(input: PageInput): PublicStatus {
  const { row, page, roster } = input
  const state: PublicStatus['state'] =
    input.service === 'active'
      ? roster.ready
        ? 'online'
        : 'starting'
      : input.service === 'activating'
        ? 'starting'
        : 'offline'
  let players: PublicStatus['players'] = null
  if (page.show.players !== 'none') {
    const names = state === 'online' ? (roster.players ?? []) : []
    players = { count: names.length, max: input.maxPlayers ?? roster.max }
    if (page.show.players === 'names') players.list = input.withUuids(names)
  }
  return {
    name: row.name,
    displayName: row.displayName,
    description: page.description,
    address: joinAddress(row, input.machine),
    state,
    players,
    version: page.show.version
      ? { minecraft: row.mcVersion, loader: LOADERS[row.loader] ?? row.loader }
      : null,
  }
}
