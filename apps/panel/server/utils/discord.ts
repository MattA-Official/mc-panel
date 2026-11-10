import { deriveSecret } from 'nuxt/server'
import { sealer } from '../backups/offsite'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { getSetting } from '../settings'
import { rolePermissions } from '../auth/access'
import { discordAccess } from '../discord/roles'
import type { Interaction } from '../discord/interactions'
import type { Access } from '../../shared/permissions'
import { readPublicPage } from '../../shared/public-page'
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
  commands = new CommandRegistry().add(statusCommand(source)).add(playersCommand(source))
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
