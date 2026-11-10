import { ACCEPTS, CONTENT_KINDS } from '@flytower/providers'
import { z } from 'zod'
import { readLock } from '../../../../spec/lock'

const Query = z.object({
  kind: z.enum(CONTENT_KINDS),
  q: z.string().max(100).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  source: z.enum(['modrinth', 'hangar']).default('modrinth'),
  /** Include Modrinth projects marked client-only. */
  clientOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

/** Searches Modrinth (or Hangar, for plugins) for content this server's loader and version can run. */
export default defineEventHandler(async (event) => {
  const { name } = await specContext(event)
  const { kind, q, offset, source, clientOnly } = await getValidatedQuery(event, Query.parse)
  const row = findServer(name)
  if (!ACCEPTS[row.loader].includes(kind)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${{ vanilla: 'Vanilla', fabric: 'Fabric', paper: 'Paper' }[row.loader]} servers don't run ${kind}s.`,
    })
  }
  if (source === 'hangar' && kind !== 'plugin') {
    throw createError({ statusCode: 400, statusMessage: 'Hangar only has plugins.' })
  }
  const lock = await readLock(serverDir(name)).catch(() => null)
  const installed = new Set(lock?.content.map((l) => l.projectId) ?? [])
  const res = await providerCall(() =>
    (source === 'hangar' ? useHangar() : useModrinth()).search(q, {
      kind,
      target: { loader: row.loader, minecraft: row.mcVersion },
      offset,
      clientOnly,
    }),
  )
  return {
    total: res.total,
    hits: res.hits.map((h) => ({ ...h, installed: installed.has(h.projectId) })),
  }
})
