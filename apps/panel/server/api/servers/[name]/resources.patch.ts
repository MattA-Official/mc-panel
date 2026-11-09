import { and, eq, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '../../../db'
import { budgetProblem } from '../../../memory'

const Params = z.object({ name: z.string().max(40) })
const Body = z
  .object({
    memoryMb: z.number().int().min(1024).max(65536).optional(),
    port: z.number().int().min(1024).max(65535).optional(),
  })
  .refine((b) => b.memoryMb !== undefined || b.port !== undefined, 'Nothing to change.')

/** Changes memory and/or the game port. Both apply on the next restart. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  const body = await readValidatedBody(event, Body.parse)
  const server = findServer(name)
  const db = useDb()

  const port = body.port !== undefined && body.port !== server.port ? body.port : undefined
  const memoryMb =
    body.memoryMb !== undefined && body.memoryMb !== server.memoryMb ? body.memoryMb : undefined
  if (port === undefined && memoryMb === undefined) return { changed: false }

  if (port !== undefined) {
    const clash = db
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .where(
        and(
          ne(schema.servers.name, name),
          or(eq(schema.servers.port, port), eq(schema.servers.rconPort, port)),
        ),
      )
      .get()
    if (clash || port === server.rconPort) {
      throw createError({
        statusCode: 409,
        statusMessage: `Port ${port} is already used${clash ? ` by ${clash.name}` : ' for RCON'}.`,
      })
    }
  }

  if (memoryMb !== undefined) {
    const jobs = useJobs()
    const tooBig = budgetProblem(jobs.totalMemoryMb(), jobs.memoryUsers(), { name, memoryMb })
    if (tooBig) throw createError({ statusCode: 409, statusMessage: tooBig })
  }

  try {
    await agent('server.configure', { name, memoryMb, port })
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
  if (port !== undefined) await writeProperties(name, { 'server-port': String(port) })
  db.update(schema.servers)
    .set({
      ...(port !== undefined ? { port } : {}),
      ...(memoryMb !== undefined ? { memoryMb } : {}),
    })
    .where(eq(schema.servers.name, name))
    .run()
  db.insert(schema.audit)
    .values({
      userId: user.id,
      action: 'server.resources',
      target: name,
      detail: { port, memoryMb },
    })
    .run()
  return { changed: true }
})
