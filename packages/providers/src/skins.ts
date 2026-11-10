import { USER_AGENT } from './http.ts'
import { ProviderError, type Fetch } from './types.ts'

/**
 * Player skins from Mojang: the session server's profile says which texture a player wears,
 * and textures.minecraft.net serves it by hash. A texture hash always names the same image.
 */

const SESSION = 'https://sessionserver.mojang.com/session/minecraft/profile'
const TEXTURES = 'https://textures.minecraft.net/texture'
/** Skins are 64×64 (or 64×32) PNGs, a few kilobytes. Anything far bigger isn't one. */
const MAX_TEXTURE_BYTES = 64 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const HASH = /^[0-9a-f]{32,64}$/

/** The game's two classic default skins, as textures.minecraft.net hashes. */
export const DEFAULT_SKINS = {
  steve: '1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b',
  alex: '3b60a1f6d562f52aaebbf1434f1de147933a3affe0e764fa49ea057536623cd3',
} as const

/** A UUID as 32 lower-case hex digits, from either form. Null if it isn't one. */
export function uuidHex(uuid: string): string | null {
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))
    return null
  return uuid.replace(/-/g, '').toLowerCase()
}

/**
 * Mojang accounts have version 4 UUIDs. Offline-mode servers make version 3 ones from the
 * name, which Mojang has never heard of, so there's nothing to look up.
 */
export const isMojangUuid = (hex: string) => hex[12] === '4'

/**
 * The default skin the classic game gives a UUID: Alex when Java's UUID.hashCode() is odd,
 * Steve when it's even. hashCode() XORs the two 64-bit halves, then the two 32-bit halves
 * of that, so its lowest bit is the XOR of the lowest bits of the four 32-bit words.
 */
export function defaultSkin(hex: string): keyof typeof DEFAULT_SKINS {
  let bit = 0
  for (let i = 0; i < 4; i++) bit ^= parseInt(hex.slice(i * 8 + 7, i * 8 + 8), 16) & 1
  return bit ? 'alex' : 'steve'
}

/**
 * The skin texture hash from a session-server profile, or null when the player wears the
 * default skin. Only textures.minecraft.net URLs are accepted.
 */
export function skinHash(profile: unknown): string | null {
  const props = (profile as { properties?: { name?: string; value?: string }[] })?.properties
  const value = Array.isArray(props) ? props.find((p) => p?.name === 'textures')?.value : undefined
  if (typeof value !== 'string') return null
  let url: unknown
  try {
    url = JSON.parse(Buffer.from(value, 'base64').toString('utf8'))?.textures?.SKIN?.url
  } catch {
    return null
  }
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname !== 'textures.minecraft.net') return null
  const m = parsed.pathname.match(/^\/texture\/([0-9a-fA-F]+)$/)
  const hash = m?.[1]?.toLowerCase()
  return hash && HASH.test(hash) ? hash : null
}

/**
 * Which skin a Mojang account wears: a texture hash, null for the default skin (including
 * accounts Mojang doesn't know). Throws when Mojang can't be reached or refuses.
 */
export async function fetchSkinHash(fetchImpl: Fetch, hex: string): Promise<string | null> {
  let res: Response
  try {
    res = await fetchImpl(`${SESSION}/${hex}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ProviderError("Couldn't reach Mojang for the player's skin.")
  }
  if (res.status === 204 || res.status === 404) return null
  if (!res.ok) throw new ProviderError(`Mojang answered ${res.status}.`)
  return skinHash(await res.json())
}

export const isPng = (bytes: Uint8Array) =>
  bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)

/** Downloads a skin texture by hash, checking it's a PNG of a sensible size. */
export async function fetchTexture(fetchImpl: Fetch, hash: string): Promise<Uint8Array> {
  if (!HASH.test(hash)) throw new ProviderError('That isn’t a texture hash.')
  let res: Response
  try {
    res = await fetchImpl(`${TEXTURES}/${hash}`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ProviderError("Couldn't reach Mojang for the skin image.")
  }
  if (!res.ok) throw new ProviderError(`Mojang answered ${res.status} for the skin image.`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_TEXTURE_BYTES) throw new ProviderError('That skin image is too big.')
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_TEXTURE_BYTES) throw new ProviderError('That skin image is too big.')
  if (!isPng(bytes)) throw new ProviderError("That skin image isn't a PNG.")
  return bytes
}
