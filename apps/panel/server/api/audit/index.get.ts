import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { can } from '../../../shared/permissions'
import { schema } from '../../db'

const Query = z.object({
  server: z.string().max(40).optional(),
  kind: z.enum(Object.keys(AUDIT_KINDS) as [AuditKind, ...AuditKind[]]).optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Who did what, newest first, as sentences. Details with secrets in them are left out. */
export default defineEventHandler(async (event) => {
  const { access } = await requireSignedIn(event)
  // Without activity.all, a person sees entries about the servers they can see.
  const visible = (target: string | null) =>
    can(access, 'activity.all') || (target !== null && can(access, 'server.view', target))
  const q = await getValidatedQuery(event, Query.parse)
  const a = schema.audit
  const read = (before?: number) =>
    useDb()
      .select({
        id: a.id,
        at: a.at,
        action: a.action,
        target: a.target,
        detail: a.detail,
        user: schema.users.name,
      })
      .from(a)
      .leftJoin(schema.users, eq(schema.users.id, a.userId))
      .where(
        and(q.server ? eq(a.target, q.server) : undefined, before ? lt(a.id, before) : undefined),
      )
      .orderBy(desc(a.id))
      .limit(500)
      .all()

  // Kinds come from auditKind(), the one place that knows them, so filter in batches.
  type Row = ReturnType<typeof read>[number]
  const found: Row[] = []
  let before = q.before
  for (;;) {
    const batch = read(before)
    found.push(
      ...batch.filter((r) => visible(r.target) && (!q.kind || auditKind(r.action) === q.kind)),
    )
    if (found.length > q.limit || batch.length < 500) break
    before = batch.at(-1)!.id
  }
  const page = found.slice(0, q.limit)
  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.at,
      user: auditActor(r.action, r.user),
      action: r.action,
      kind: auditKind(r.action),
      target: r.target,
      text: describeAudit(r.action, r.target, r.detail),
    })),
    next: found.length > q.limit ? page.at(-1)!.id : null,
  }
})
