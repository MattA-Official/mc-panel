import { ZodError } from 'zod'
import { CreateServerInput, JobError } from '../../jobs/runner'

/** Starts a create-server job and returns its id; progress follows on `job:<id>`. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'servers.create')
  const body = await readBody(event)
  try {
    const { jobId } = useJobs().createServer(CreateServerInput.parse(body))
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
