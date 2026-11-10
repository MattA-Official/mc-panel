/** Panel-wide settings, stored as JSON in the settings table. Each key has a type and a default. */
import { eq } from 'drizzle-orm'
import { schema, type DbOrTx } from './db'
import type { DiskReport } from '../shared/disk'
import type { BrandingSettings, ImageType } from '../shared/branding'

export type UpdateChannel = 'stable' | 'beta'

export interface Settings {
  /** Which releases are offered: stable only, or betas too. Unset until someone chooses. */
  'update.channel': UpdateChannel
  /** The last disk use measurement, so the System page has figures straight after a restart. */
  'disk.usage': DiskReport
  /** The install's own name, colour and font. Missing fields mean Flytower's own. */
  branding: Partial<BrandingSettings>
  /** Cleaned uploads, base64, with a hash for cache busting. */
  'branding.logo': StoredImage
  'branding.favicon': StoredImage
}

export interface StoredImage {
  type: ImageType
  data: string
  hash: string
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

export function deleteSetting(db: DbOrTx, key: keyof Settings) {
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run()
}
