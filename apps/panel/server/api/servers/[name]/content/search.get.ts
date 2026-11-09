import { ACCEPTS } from '@flytower/providers'
import { z } from 'zod'
import { readLock } from '../../../../spec/lock'

const Query = z.object({
  kind: z.enum(['mod', 'datapack']),
  q: z.string().max(100).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
})

/** Searches Modrinth for content this server's loader and version can run. */
export default defineEventHandler(async (event) => {
  const { name } = await specContext(event)
  const { kind, q, offset } = await getValidatedQuery(event, Query.parse)
  const row = findServer(name)
  if (!ACCEPTS[row.loader].includes(kind)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${row.loader === 'paper' ? 'Paper' : 'Vanilla'} servers don't run ${kind}s.`,
    })
  }
  const lock = await readLock(serverDir(name)).catch(() => null)
  const installed = new Set(lock?.content.map((l) => l.projectId) ?? [])
  const res = await providerCall(() =>
    useModrinth().search(q, {
      kind,
      target: { loader: row.loader, minecraft: row.mcVersion },
      offset,
    }),
  )
  return {
    total: res.total,
    hits: res.hits.map((h) => ({ ...h, installed: installed.has(h.projectId) })),
  }
})
