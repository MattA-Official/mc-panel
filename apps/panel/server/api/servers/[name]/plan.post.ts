import { z } from 'zod'
import { ServerSpec } from '../../../../shared/spec'
import { parseSpec } from '../../../spec/yaml'

const Body = z.union([
  z.object({
    yaml: z.string().max(256 * 1024),
    upgrade: z.union([z.literal(true), z.array(z.string().max(64)).max(500)]).optional(),
  }),
  z.object({
    spec: z.unknown(),
    upgrade: z.union([z.literal(true), z.array(z.string().max(64)).max(500)]).optional(),
  }),
])

/**
 * Works out what applying a spec would change. Answers `{ ok: false, issues }` for a spec
 * that doesn't check out, or `{ ok: true, plan }`. Seeing the server is enough to get in; each
 * part of the spec that would change then needs its own permission (spec/sections.ts).
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name, specs } = await specContext(event)
  const body = await readValidatedBody(event, Body.parse)
  let spec: ServerSpec
  if ('yaml' in body) {
    const parsed = parseSpec(body.yaml)
    if (!parsed.ok) return parsed
    spec = parsed.spec
  } else {
    const parsed = ServerSpec.safeParse(body.spec)
    if (!parsed.success) {
      return {
        ok: false as const,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }
    }
    spec = parsed.data
  }
  requireSpecChange(event, name, await specHttp(() => specs.needs(name, spec, body.upgrade)))
  const plan = await specHttp(() => specs.plan(name, spec, body.upgrade))
  return { ok: true as const, plan }
})
