import type { H3Event } from 'h3'
import { z } from 'zod'
import { schema } from '../db'
import { FileError } from '../files'

const Params = z.object({ name: z.string().max(40) })

/** Common to every file route: signed in, a real server, and its folder. */
export async function fileContext(event: H3Event) {
  const { user } = await requireUserSession(event)
  const { name } = await getValidatedRouterParams(event, Params.parse)
  findServer(name)
  return { user, name, root: serverDir(name) }
}

/** Maps FileError to HTTP and audits what changed. */
export async function fileAction<T>(
  ctx: { user: { id: number }; name: string },
  action: string | null,
  detail: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const out = await fn()
    if (action) {
      useDb()
        .insert(schema.audit)
        .values({ userId: ctx.user.id, action: `files.${action}`, target: ctx.name, detail })
        .run()
    }
    return out
  } catch (err) {
    if (err instanceof FileError)
      throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
}

export const PathQuery = z.object({ path: z.string().max(4096).default('/') })
