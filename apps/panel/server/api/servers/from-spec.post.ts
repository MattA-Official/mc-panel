import { z } from 'zod'
import { DEFAULT_MEMORY_MB } from '../../../shared/spec'
import { JobError } from '../../jobs/runner'
import { parseSpec } from '../../spec/yaml'

const Body = z.object({
  yaml: z.string().max(256 * 1024),
  acceptEula: z.literal(true, { error: 'You need to accept the Minecraft EULA.' }),
})

/**
 * Creates a server from a pasted spec: the same job as the form, with the spec's
 * properties, backup settings and content list carried over. Content is installed
 * afterwards through a plan the person can review.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidatedBody(event, Body.parse)
  const parsed = parseSpec(body.yaml)
  if (!parsed.ok) return parsed
  const spec = parsed.spec
  try {
    const { jobId, done } = useJobs().createServer(
      {
        name: spec.name,
        displayName: spec.displayName ?? spec.name,
        loader: spec.loader.type,
        mcVersion: spec.loader.minecraft,
        loaderVersion: spec.loader.version ?? 'latest-stable',
        memoryMb: spec.memory ?? DEFAULT_MEMORY_MB,
        port: spec.port,
        acceptEula: true,
      },
      undefined,
      {
        properties: Object.fromEntries(
          Object.entries(spec.properties).map(([k, v]) => [k, String(v)]),
        ),
        backups: spec.backups,
        content: spec.content,
        hostname: spec.hostname ?? null,
      },
    )
    void done.then(() => syncBackupSchedules())
    audit(user.id, 'server.create', spec.name, { from: 'spec' })
    setResponseStatus(event, 202)
    return { ok: true as const, jobId, hasContent: spec.content.length > 0 }
  } catch (err) {
    if (err instanceof JobError) throw createError({ statusCode: 409, statusMessage: err.message })
    throw err
  }
})
