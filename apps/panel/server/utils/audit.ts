import { schema } from '../db'

/** Records who did what to which server. */
export function audit(userId: number, action: string, target: string | null, detail?: object) {
  useDb()
    .insert(schema.audit)
    .values({ userId, action, target, detail: detail as Record<string, unknown> })
    .run()
}
