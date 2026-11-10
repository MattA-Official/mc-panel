import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { DEFAULT_SKINS, offlineUuid, uuidHex, type Fetch } from '@flytower/providers'
import { isFresh, LOOKUPS_PER_MINUTE, PROFILE_TTL_MS, SkinCache } from '../server/skins/cache'

const NOTCH = '069a79f444e94726a5befca90e38aaf5'
const HASH = '292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680'
const png = (tag: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag])
const PNGS: Record<string, Uint8Array> = {
  [HASH]: png(1),
  [DEFAULT_SKINS.steve]: png(2),
  [DEFAULT_SKINS.alex]: png(3),
}
const profile = (hash: string | null) => ({
  id: NOTCH,
  properties: [
    {
      name: 'textures',
      value: Buffer.from(
        JSON.stringify({
          textures: hash ? { SKIN: { url: `http://textures.minecraft.net/texture/${hash}` } } : {},
        }),
      ).toString('base64'),
    },
  ],
})

/** A pretend Mojang that counts what it's asked. */
function mojang(opts: { skin?: string | null; down?: boolean } = {}) {
  const calls = { profiles: 0, textures: 0 }
  const fetch: Fetch = async (url) => {
    if (opts.down) throw new Error('offline')
    const u = String(url)
    if (u.includes('sessionserver')) {
      calls.profiles++
      return Response.json(profile(opts.skin === undefined ? HASH : opts.skin))
    }
    calls.textures++
    const bytes = PNGS[u.split('/').pop()!]
    return bytes ? new Response(bytes) : new Response(null, { status: 404 })
  }
  return { fetch, calls, set: (o: typeof opts) => Object.assign(opts, o) }
}

const dir = () => mkdtempSync(join(tmpdir(), 'ft-skins-'))

describe('skin cache', () => {
  it('trusts a profile for a day', () => {
    expect(isFresh({ skin: null, checkedAt: 1000 }, 1000 + PROFILE_TTL_MS - 1)).toBe(true)
    expect(isFresh({ skin: null, checkedAt: 1000 }, 1000 + PROFILE_TTL_MS)).toBe(false)
    // A clock that went backwards doesn't keep a record forever.
    expect(isFresh({ skin: null, checkedAt: 5000 }, 1000)).toBe(false)
  })

  it("serves a player's skin, then asks Mojang nothing on the next view", async () => {
    const m = mojang()
    const d = dir()
    const cache = new SkinCache({ dir: d, fetch: m.fetch })
    expect(await cache.skin(NOTCH)).toEqual(PNGS[HASH]!)
    expect(m.calls).toEqual({ profiles: 1, textures: 1 })
    expect(await cache.skin(NOTCH)).toEqual(PNGS[HASH]!)
    expect(m.calls).toEqual({ profiles: 1, textures: 1 })
    // A fresh process reads the same files.
    const again = new SkinCache({ dir: d, fetch: m.fetch })
    expect(await again.skin(NOTCH)).toEqual(PNGS[HASH]!)
    expect(m.calls).toEqual({ profiles: 1, textures: 1 })
  })

  it('refreshes after a day, and keeps the old skin if Mojang is down', async () => {
    let now = 1_000_000
    const m = mojang()
    const cache = new SkinCache({ dir: dir(), fetch: m.fetch, now: () => now })
    await cache.skin(NOTCH)
    now += PROFILE_TTL_MS
    m.set({ down: true })
    expect(await cache.skin(NOTCH)).toEqual(PNGS[HASH]!)
    m.set({ down: false, skin: null })
    // The failed refresh wrote nothing, so the next view asks again and sees the change.
    expect(await cache.skin(NOTCH)).toEqual(PNGS[DEFAULT_SKINS.steve]!)
    expect(m.calls.profiles).toBe(2)
  })

  it('gives offline and unknown players a default skin without asking about them', async () => {
    const m = mojang()
    const cache = new SkinCache({ dir: dir(), fetch: m.fetch })
    const offline = uuidHex(offlineUuid('Notch'))!
    const skin = await cache.skin(offline)
    expect([PNGS[DEFAULT_SKINS.steve], PNGS[DEFAULT_SKINS.steve]]).toContainEqual(skin!)
    expect(m.calls.profiles).toBe(0)

    const unknown = mojang({ skin: null })
    const c2 = new SkinCache({ dir: dir(), fetch: unknown.fetch })
    // Notch's UUID gives Steve by the classic rule.
    expect(await c2.skin(NOTCH)).toEqual(PNGS[DEFAULT_SKINS.steve]!)
  })

  it('falls back to the default skin when a texture is missing, and null with no network', async () => {
    const m = mojang({ skin: 'c'.repeat(64) })
    const cache = new SkinCache({ dir: dir(), fetch: m.fetch })
    expect(await cache.skin(NOTCH)).toEqual(PNGS[DEFAULT_SKINS.steve]!)
    const down = new SkinCache({ dir: dir(), fetch: mojang({ down: true }).fetch })
    expect(await down.skin(NOTCH)).toBeNull()
  })

  it('shares one lookup between concurrent views and stays under the rate limit', async () => {
    const m = mojang()
    const cache = new SkinCache({ dir: dir(), fetch: m.fetch, now: () => 0 })
    await Promise.all([cache.skin(NOTCH), cache.skin(NOTCH), cache.skin(NOTCH)])
    expect(m.calls).toEqual({ profiles: 1, textures: 1 })

    const many = Array.from(
      { length: LOOKUPS_PER_MINUTE + 5 },
      (_, i) => `${i.toString(16).padStart(12, '0')}4${'0'.repeat(19)}`,
    )
    await Promise.all(many.map((u) => cache.skin(u)))
    expect(m.calls.profiles).toBe(LOOKUPS_PER_MINUTE)
  })
})
