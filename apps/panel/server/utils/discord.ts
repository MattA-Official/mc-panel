import { deriveSecret } from 'nuxt/server'
import { sealer } from '../backups/offsite'
import { DiscordError, DiscordService } from '../discord/service'

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
