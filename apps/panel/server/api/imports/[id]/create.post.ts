import { ZodError } from 'zod'
import { CreateServerInput, JobError } from '../../../jobs/runner'

/** Turns a ready import into a server, through the create-server job. */
export default defineEventHandler(async (event) => {
  const { user, imports, id } = await importContext(event)
  const meta = await importHttp(() => imports.get(id))
  if (meta.state !== 'ready' || !meta.detected) {
    throw createError({ statusCode: 409, statusMessage: "This import isn't ready yet." })
  }
  try {
    const input = CreateServerInput.parse(await readBody(event))
    const { jobId, done } = useJobs().createServer(input, {
      root: meta.detected.root,
      kind: meta.detected.kind,
    })
    void done.then((job) => {
      if (job.state === 'succeeded') void imports.remove(id)
    })
    audit(user.id, 'server.import', input.name, { id, label: meta.label })
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
