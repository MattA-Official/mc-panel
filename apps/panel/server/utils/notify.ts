import { deriveSecret } from 'nuxt/server'
import { eq } from 'drizzle-orm'
import { sealer } from '../backups/offsite'
import { schema } from '../db'
import { NotifyError, NotifyService } from '../notify'

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
