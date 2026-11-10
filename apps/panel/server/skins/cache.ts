import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_SKINS,
  defaultSkin,
  fetchSkinHash,
  fetchTexture,
  isMojangUuid,
  type Fetch,
} from '@flytower/providers'

/** How long a player's skin choice is trusted before asking Mojang again. */
export const PROFILE_TTL_MS = 24 * 60 * 60_000
/** Profile lookups allowed per minute, far inside what Mojang's session server allows. */
export const LOOKUPS_PER_MINUTE = 60

export interface ProfileRecord {
  /** Texture hash, or null for the default skin. */
  skin: string | null
  /** When Mojang was last asked, in ms. */
  checkedAt: number
}

export const isFresh = (record: ProfileRecord, now: number) =>
  now - record.checkedAt < PROFILE_TTL_MS && record.checkedAt <= now

export interface SkinCacheDeps {
  dir: string
  fetch?: Fetch
  now?: () => number
}

/**
 * Player skins on disk. `profiles/<uuid>.json` says which texture a player wears (refreshed
 * after a day, kept when Mojang is down); `textures/<hash>.png` holds the images, which
 * never change for a hash, so they never expire.
 */
export class SkinCache {
  private readonly fetch: Fetch
  private readonly now: () => number
  private readonly lookups = new Map<string, Promise<string | null>>()
  private readonly downloads = new Map<string, Promise<Uint8Array>>()
  private window = { start: 0, count: 0 }

  constructor(private readonly deps: SkinCacheDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch
    this.now = deps.now ?? Date.now
  }

  /** The skin PNG for a UUID (32 lower-case hex digits). Null only if nothing can be had. */
  async skin(hex: string): Promise<Uint8Array | null> {
    const fallback = DEFAULT_SKINS[defaultSkin(hex)]
    const hash = (isMojangUuid(hex) ? await this.skinHash(hex) : null) ?? fallback
    const png = await this.texture(hash).catch(() => null)
    if (png || hash === fallback) return png
    return this.texture(fallback).catch(() => null)
  }

  /** Which texture a Mojang account wears, from the cache when it's fresh. */
  private async skinHash(hex: string): Promise<string | null> {
    const record = await this.readProfile(hex)
    if (record && isFresh(record, this.now())) return record.skin
    let pending = this.lookups.get(hex)
    if (!pending) {
      pending = this.lookup(hex, record).finally(() => this.lookups.delete(hex))
      this.lookups.set(hex, pending)
    }
    return pending
  }

  private async lookup(hex: string, stale: ProfileRecord | null): Promise<string | null> {
    // Over the limit or Mojang down: the old answer if there is one, else the default skin,
    // and nothing is written so the next view asks again.
    if (!this.allowLookup()) return stale?.skin ?? null
    try {
      const skin = await fetchSkinHash(this.fetch, hex)
      await this.write(this.profilePath(hex), JSON.stringify({ skin, checkedAt: this.now() }))
      return skin
    } catch {
      return stale?.skin ?? null
    }
  }

  private allowLookup(): boolean {
    const now = this.now()
    if (now - this.window.start >= 60_000) this.window = { start: now, count: 0 }
    if (this.window.count >= LOOKUPS_PER_MINUTE) return false
    this.window.count++
    return true
  }

  private async texture(hash: string): Promise<Uint8Array> {
    const path = join(this.deps.dir, 'textures', `${hash}.png`)
    try {
      return new Uint8Array(await readFile(path))
    } catch {
      // Not cached yet.
    }
    let pending = this.downloads.get(hash)
    if (!pending) {
      pending = fetchTexture(this.fetch, hash)
        .then(async (png) => {
          await this.write(path, png)
          return png
        })
        .finally(() => this.downloads.delete(hash))
      this.downloads.set(hash, pending)
    }
    return pending
  }

  private profilePath(hex: string) {
    return join(this.deps.dir, 'profiles', `${hex}.json`)
  }

  private async readProfile(hex: string): Promise<ProfileRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(this.profilePath(hex), 'utf8')) as ProfileRecord
      const ok =
        (parsed.skin === null || typeof parsed.skin === 'string') &&
        typeof parsed.checkedAt === 'number'
      return ok ? parsed : null
    } catch {
      return null
    }
  }

  private async write(path: string, data: string | Uint8Array) {
    await mkdir(join(path, '..'), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, path)
  }
}
