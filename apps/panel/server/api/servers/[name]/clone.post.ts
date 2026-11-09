import { join } from 'node:path'
import { z, ZodError } from 'zod'
import { cloneSource } from '../../../clone'
import { JobError } from '../../../jobs/runner'

const Body = z.object({
  name: z.string(),
  displayName: z.string(),
  port: z.number().int().optional(),
  memoryMb: z.number().int(),
  withWorld: z.boolean(),
  acceptEula: z.literal(true, { error: 'You need to accept the Minecraft EULA.' }),
})

/** Copies a server (optionally without its world) to a new one, through the create job. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const from = findServer(getRouterParam(event, 'name') ?? '')
  const body = await readValidatedBody(event, Body.parse)
  const staging = join(
    useRuntimeConfig().importsDir,
    `clone-${Buffer.from(crypto.getRandomValues(new Uint8Array(6))).toString('hex')}`,
  )
  try {
    const { jobId, done } = useJobs().createServer(
      {
        name: body.name,
        displayName: body.displayName,
        loader: from.loader,
        mcVersion: from.mcVersion,
        loaderVersion: from.loaderVersion ?? 'latest-stable',
        memoryMb: body.memoryMb,
        port: body.port,
        acceptEula: true,
      },
      cloneSource({ serverDir, backups: useBackups(), readProperties }, from.name, staging, {
        withWorld: body.withWorld,
      }),
      {
        content: from.content ?? [],
        backups: {
          schedule: from.backupSchedule,
          timezone: from.backupTz,
          keep: { last: from.keepLast, daily: from.keepDaily, weekly: from.keepWeekly },
        },
      },
    )
    void done.then(() => syncBackupSchedules())
    audit(user.id, 'server.clone', body.name, { from: from.name, withWorld: body.withWorld })
    setResponseStatus(event, 202)
    return { jobId }
  } catch (err) {
    if (err instanceof ZodError) {
      throw createError({ statusCode: 400, statusMessage: err.issues[0]?.message ?? 'Invalid' })
    }
    if (err instanceof JobError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
