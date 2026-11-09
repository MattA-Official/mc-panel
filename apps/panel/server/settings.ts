/** Panel-wide settings, stored as JSON in the settings table. Each key has a type and a default. */
import { eq } from 'drizzle-orm'
import { schema, type DbOrTx } from './db'

export type UpdateChannel = 'stable' | 'beta'

export interface Settings {
  /** Which releases are offered: stable only, or betas too. Unset until someone chooses. */
  'update.channel': UpdateChannel
}

export function getSetting<K extends keyof Settings>(db: DbOrTx, key: K): Settings[K] | undefined {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()
  return row?.value as Settings[K] | undefined
}

export function setSetting<K extends keyof Settings>(db: DbOrTx, key: K, value: Settings[K]) {
  db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } })
    .run()
}
