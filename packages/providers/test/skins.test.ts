import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_SKINS,
  defaultSkin,
  fetchSkinHash,
  fetchTexture,
  isMojangUuid,
  offlineUuid,
  skinHash,
  uuidHex,
  type Fetch,
} from '../src/index.ts'

const NOTCH = '069a79f444e94726a5befca90e38aaf5'
const HASH = '292009a4925b58f02c77dadc3ecef07ea4c7472f64e0fdc32ce5522489362680'

const profile = (textures: unknown) => ({
  id: NOTCH,
  name: 'Notch',
  properties: [
    {
      name: 'textures',
      value: Buffer.from(JSON.stringify({ textures })).toString('base64'),
    },
  ],
})

/** Java's UUID.hashCode(), done the long way, to check the shortcut against. */
function javaHashCode(hex: string): number {
  const msb = BigInt.asIntN(64, BigInt(`0x${hex.slice(0, 16)}`))
  const lsb = BigInt.asIntN(64, BigInt(`0x${hex.slice(16)}`))
  const hilo = msb ^ lsb
  return Number(BigInt.asIntN(32, hilo >> 32n) ^ BigInt.asIntN(32, hilo))
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

describe('skins', () => {
  it('normalises UUIDs and tells Mojang accounts from offline ones', () => {
    expect(uuidHex('069A79F4-44E9-4726-A5BE-FCA90E38AAF5')).toBe(NOTCH)
    expect(uuidHex(NOTCH)).toBe(NOTCH)
    expect(uuidHex('069a79f4-44e94726-a5be-fca90e38aaf5')).toBeNull()
    expect(uuidHex('../../etc/passwd')).toBeNull()
    expect(uuidHex('')).toBeNull()
    expect(isMojangUuid(NOTCH)).toBe(true)
    expect(isMojangUuid(uuidHex(offlineUuid('Notch'))!)).toBe(false)
  })

  it('picks the default skin the way the game does', () => {
    const samples = [
      NOTCH,
      uuidHex(offlineUuid('Notch'))!,
      uuidHex(offlineUuid('Steve'))!,
      uuidHex(offlineUuid('Alex'))!,
      'ffffffffffffffffffffffffffffffff',
      '00000000000000000000000000000001',
      ...Array.from({ length: 50 }, (_, i) => uuidHex(offlineUuid(`player${i}`))!),
    ]
    for (const hex of samples) {
      expect(defaultSkin(hex)).toBe((javaHashCode(hex) & 1) === 1 ? 'alex' : 'steve')
    }
    const picks = new Set(samples.map(defaultSkin))
    expect(picks).toEqual(new Set(['steve', 'alex']))
  })

  it('reads the skin hash from a profile', () => {
    expect(
      skinHash(profile({ SKIN: { url: `http://textures.minecraft.net/texture/${HASH}` } })),
    ).toBe(HASH)
    // Default skin: no SKIN entry.
    expect(skinHash(profile({}))).toBeNull()
    // Anywhere but Mojang's texture host is refused.
    expect(skinHash(profile({ SKIN: { url: `https://evil.example/texture/${HASH}` } }))).toBeNull()
    expect(
      skinHash(profile({ SKIN: { url: `http://textures.minecraft.net/texture/../x` } })),
    ).toBeNull()
    expect(skinHash({ properties: [{ name: 'textures', value: '!!not base64 json' }] })).toBeNull()
    expect(skinHash(null)).toBeNull()
    expect(skinHash({})).toBeNull()
  })

  it('asks the session server and treats unknown accounts as default', async () => {
    const asked: string[] = []
    const fetch: Fetch = async (url) => {
      asked.push(String(url))
      if (String(url).endsWith(NOTCH))
        return Response.json(
          profile({ SKIN: { url: `http://textures.minecraft.net/texture/${HASH}` } }),
        )
      return new Response(null, { status: 204 })
    }
    expect(await fetchSkinHash(fetch, NOTCH)).toBe(HASH)
    expect(await fetchSkinHash(fetch, 'f'.repeat(32))).toBeNull()
    expect(asked[0]).toBe(`https://sessionserver.mojang.com/session/minecraft/profile/${NOTCH}`)

    const limited: Fetch = async () => new Response(null, { status: 429 })
    await expect(fetchSkinHash(limited, NOTCH)).rejects.toThrow('429')
    const down: Fetch = async () => {
      throw new Error('offline')
    }
    await expect(fetchSkinHash(down, NOTCH)).rejects.toThrow("Couldn't reach Mojang")
  })

  it('downloads textures and checks they are PNGs', async () => {
    const fetch: Fetch = async (url) =>
      String(url).endsWith(DEFAULT_SKINS.steve)
        ? new Response(PNG)
        : String(url).endsWith('a'.repeat(64))
          ? new Response('<html>')
          : new Response(new Uint8Array(70_000))
    expect(await fetchTexture(fetch, DEFAULT_SKINS.steve)).toEqual(PNG)
    await expect(fetchTexture(fetch, 'a'.repeat(64))).rejects.toThrow("isn't a PNG")
    await expect(fetchTexture(fetch, 'b'.repeat(64))).rejects.toThrow('too big')
    await expect(fetchTexture(fetch, '../etc')).rejects.toThrow('texture hash')
  })
})
