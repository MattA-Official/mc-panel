import type { H3Event } from 'h3'
import { ImportError, ImportService } from '../imports/service'

let service: ImportService | undefined

/** The one import service for this process. */
export function useImports(): ImportService {
  const config = useRuntimeConfig()
  service ??= new ImportService({
    importsDir: config.importsDir,
    archiveDir: config.archiveDir,
    pastWorldPath: (id) => {
      const exports = useExports()
      return exports.path(exports.pastWorld(id))
    },
    jobs: useJobs(),
  })
  return service
}

/** Runs `fn`, turning an ImportError into a 404 or 409. */
export async function importHttp<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ImportError) {
      throw createError({
        statusCode: err.message.startsWith('No such') ? 404 : 409,
        statusMessage: err.message,
      })
    }
    throw err
  }
}

export async function importContext(event: H3Event) {
  const { user } = await requireUserSession(event)
  return { user, id: getRouterParam(event, 'id') ?? '', imports: useImports() }
}
