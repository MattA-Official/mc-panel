import { deriveSecret } from 'nuxt/server'
import { sealer } from '../backups/offsite'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { readPublicPage } from '../../shared/public-page'
import { DiscordError, DiscordService, INTERACTIONS_PATH } from '../discord/service'
import { CommandRegistry } from '../discord/registry'
import { playersCommand, statusCommand, type ServerSource } from '../discord/commands/servers'

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
  commands = new CommandRegistry().add(statusCommand(source)).add(playersCommand(source))
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
