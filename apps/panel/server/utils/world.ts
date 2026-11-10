import type { H3Event } from 'h3'
import { z } from 'zod'
import { JobError } from '../jobs/runner'
import { WorldService } from '../world/service'

let service: WorldService | undefined

/** The one world service for this process. */
export function useWorld(): WorldService {
  service ??= new WorldService({
    db: useDb(),
    serverDir,
    agent,
    jobs: useJobs(),
    backups: useBackups(),
    exports: useExports(),
    rcon: (name, command, timeoutMs) =>
      useConsole().command(name, command, { echo: false, timeoutMs }),
    readProperties,
    writeProperties,
    stopped: (name) => useConsole().forget(name),
  })
  return service
}

const Params = z.object({ name: z.string().max(40) })

/** Signed in and a real server. */
export async function worldContext(event: H3Event) {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return { user, name, world: useWorld() }
}

/** World and backup-lock errors become 409s with their message. */
export async function worldHttp<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // WorldError and BackupError (the server is busy) are both JobErrors.
    if (err instanceof JobError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
}
