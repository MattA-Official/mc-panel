import { modrinthProvider, type ContentProvider } from '@flytower/providers'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { SpecError, SpecService } from '../spec/apply'
import { LockError } from '../spec/lock'

let modrinth: ContentProvider | undefined
let service: SpecService | undefined

/** The Modrinth provider, shared so its cache is too. */
export function useModrinth(): ContentProvider {
  modrinth ??= modrinthProvider(fetch)
  return modrinth
}

/** The one spec service for this process. */
export function useSpecs(): SpecService {
  service ??= new SpecService({
    db: useDb(),
    serverDir,
    agent,
    jobs: useJobs(),
    backups: useBackups(),
    modrinth: useModrinth(),
    fetch,
    readProperties,
    writeProperties,
    schedulesChanged: syncBackupSchedules,
    stopped: (name) => useConsole().forget(name),
  })
  return service
}

const Params = z.object({ name: z.string().max(40) })

/** Signed in and a real server. */
export async function specContext(event: H3Event) {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return { user, name, specs: useSpecs() }
}

/** Spec, lockfile and backup-lock errors become 4xx answers with their message. */
export async function specHttp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await providerCall(fn)
  } catch (err) {
    if (err instanceof SpecError || err instanceof LockError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof Error && err.name === 'JobError') {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    throw err
  }
}
