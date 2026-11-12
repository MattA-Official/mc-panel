import { deriveSecret } from 'nuxt/server'
import { sealer } from '../backups/offsite'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { getSetting } from '../settings'
import { rolePermissions } from '../auth/access'
import { discordAccess } from '../discord/roles'
import type { Interaction } from '../discord/interactions'
import { readPublicPage, showsLeaderboard } from '../../shared/public-page'
import { can, type Access } from '../../shared/permissions'
import { leaderboardCommand, statsCommand, type StatsSource } from '../discord/commands/stats'
import { DiscordError, DiscordService, INTERACTIONS_PATH } from '../discord/service'
import { CommandRegistry } from '../discord/registry'
import { playersCommand, statusCommand, type ServerSource } from '../discord/commands/servers'
import { staffCommands, type StaffDeps } from '../discord/commands/staff'
import { toMessage, type Reply } from '../discord/registry'

let service: DiscordService | undefined

/** The Discord app connection for this process. */
export function useDiscord(): DiscordService {
  if (service) return service
  const seal = sealer(() => deriveSecret('flytower:discord'))
  service = new DiscordService({
    db: useDb(),
    seal: seal.seal,
    unseal: seal.unseal,
    origin: () => {
      const { rpId } = useRuntimeConfig()
      return rpId ? `https://${rpId}` : null
    },
    commandNames: () => useCommands().names(),
    chat: discordChatState,
  })
  return service
}

/** Runs `fn`, turning a DiscordError into a 400 the System page can show. */
export async function discordHttp<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DiscordError) {
      throw createError({ statusCode: 400, statusMessage: err.message })
    }
    throw err
  }
}

let commands: CommandRegistry | undefined

/** The slash commands Flytower answers. Plugins will add theirs here too. */
export function useCommands(): CommandRegistry {
  if (commands) return commands
  const source: ServerSource = {
    servers: () =>
      useDb()
        .select({
          name: schema.servers.name,
          displayName: schema.servers.displayName,
          publicPage: schema.servers.publicPage,
        })
        .from(schema.servers)
        .all()
        .map((r) => ({
          name: r.name,
          displayName: r.displayName,
          public: readPublicPage(r.publicPage).enabled,
        })),
    async status(name) {
      const row = useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
      if (!row) throw new Error(`No server called ${name}`)
      const { rpId, machineIpv4 } = useRuntimeConfig()
      return buildPublicStatus(
        row,
        readPublicPage(row.publicPage),
        rpId || machineIpv4 || 'localhost',
      )
    },
    origin: () => useDiscord().endpointUrl()?.replace(INTERACTIONS_PATH, '') ?? null,
  }
  const staff: StaffDeps = {
    servers: source.servers,
    running: async (name) => (await useStatus().current())[name] === 'active',
    whitelist: (name, action, player) => changePlayers(name, `whitelist-${action}`, player),
    async restart(name) {
      const ready = untilReady(name)
      await powerServer(name, 'restart')
      return ready
    },
    backup(name, note) {
      const { done } = backupHttp(() => useBackups().backup(name, 'manual', note))
      return {
        done: done.then((e) => ({ ok: e.state === 'succeeded', message: e.message ?? '' })),
      }
    },
    command: (name, command) => useConsole().command(name, command),
    audit(action, target, detail) {
      useDb().insert(schema.audit).values({ userId: null, action, target, detail }).run()
    },
  }
  commands = new CommandRegistry()
    .add(statusCommand(source))
    .add(playersCommand(source))
    .add(leaderboardCommand(statsSource))
    .add(statsCommand(statsSource))
  for (const c of staffCommands(staff)) commands.add(c)
  return commands
}

/** Sends the command list to Discord if it changed. Never throws; failures show on the card. */
export async function syncDiscordCommands(force = false) {
  const registry = useCommands()
  const result = await useDiscord()
    .syncCommands(registry.definitions(), registry.hash(), force)
    .catch(() => 'failed' as const)
  if (result === 'failed') console.warn('[flytower] Discord didn’t take the command list')
  return result
}

/** The Discord role mappings, as saved on the Discord card. */
export function discordRoleMappings() {
  return getSetting(useDb(), 'discord.roles') ?? []
}

/** What the member behind an interaction may do, read fresh so a change applies at once. */
export function discordAccessFor(interaction: Interaction): Access {
  const roles = new Map(
    useDb()
      .select({ id: schema.roles.id, permissions: schema.roles.permissions })
      .from(schema.roles)
      .all()
      .map((r) => [r.id, rolePermissions(r)] as const),
  )
  return discordAccess(discordRoleMappings(), interaction, (id) => roles.get(id) ?? null)
}

/** Posts a command's follow-up (a restart or backup finishing) to its interaction. */
export async function postDiscordFollowUp(interaction: Interaction, reply: Reply) {
  await useDiscord().api.followUp(interaction.application_id, interaction.token, toMessage(reply))
}

/**
 * Stats for Discord. Someone who can see a server in Flytower gets what its Stats tab shows;
 * anyone else only servers whose public page shows leaderboards, without visits.
 */
const statsSource: StatsSource = {
  servers(access: Access) {
    return useDb()
      .select({
        name: schema.servers.name,
        displayName: schema.servers.displayName,
        publicPage: schema.servers.publicPage,
      })
      .from(schema.servers)
      .all()
      .filter((r) => statsVisibleTo(r.name, readPublicPage(r.publicPage), access))
      .map((r) => ({ name: r.name, displayName: r.displayName, public: true }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  },
  async boards(server, period, access) {
    const page = publicPageOf(server)
    if (!page) return null
    if (can(access, 'server.view', server)) {
      const o = await statsOverview(server, period, { cards: false })
      return { boards: o.boards, since: o.since }
    }
    return publicLeaderboards(server, page, period)
  },
  async player(server, name, access) {
    const page = publicPageOf(server)
    if (!page || !statsVisibleTo(server, page, access)) return null
    const lower = name.toLowerCase()
    const find = async (period: 'all' | 'week') =>
      (await statsOverview(server, period)).players.find((p) => p.name.toLowerCase() === lower)
    const all = await find('all')
    if (!all) return null
    const week = await find('week')
    const full = can(access, 'server.view', server)
    return {
      name: all.name,
      uuid: all.uuid,
      allTime: all.stats,
      week: week?.stats ?? { playtime: 0, deaths: 0, mob_kills: 0, distance: 0, blocks_mined: 0 },
      ...(full && { lastSeen: all.lastSeen, sessions: all.sessions }),
    }
  },
  async playerNames(server, access) {
    const page = publicPageOf(server)
    if (!page || !statsVisibleTo(server, page, access)) return []
    return (await statsOverview(server, 'all')).players.map((p) => p.name)
  },
}

function publicPageOf(server: string) {
  const row = useDb()
    .select({ publicPage: schema.servers.publicPage })
    .from(schema.servers)
    .where(eq(schema.servers.name, server))
    .get()
  return row ? readPublicPage(row.publicPage) : null
}

/** Whether a caller may see a server's stats in Discord. */
function statsVisibleTo(server: string, page: ReturnType<typeof readPublicPage>, access: Access) {
  if (can(access, 'server.view', server)) return true
  return page.enabled && showsLeaderboard(page, statsSettings(server).enabled)
}
