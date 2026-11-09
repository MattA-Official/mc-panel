import { USER_AGENT } from './http.ts'
import { ProviderError, type Fetch } from './types.ts'

export interface PlayerProfile {
  uuid: string
  name: string
}

export const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/

/** Adds the dashes Minecraft's JSON files use to a 32-character hex UUID. */
export const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

/** Looks a player up with Mojang. Null when no such account exists. */
export async function lookupPlayer(fetchImpl: Fetch, name: string): Promise<PlayerProfile | null> {
  if (!PLAYER_NAME.test(name)) return null
  let res: Response
  try {
    res = await fetchImpl(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
      { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) },
    )
  } catch {
    throw new ProviderError("Couldn't reach Mojang to look the player up.")
  }
  if (res.status === 404 || res.status === 204) return null
  if (!res.ok) throw new ProviderError(`Mojang answered ${res.status}. Try again in a minute.`)
  const body = (await res.json()) as { id: string; name: string }
  return { uuid: dashed(body.id), name: body.name }
}

/**
 * The UUID an offline-mode server gives a name: Java's UUID.nameUUIDFromBytes of
 * "OfflinePlayer:<name>", an MD5-based version 3 UUID.
 */
export function offlineUuid(name: string): string {
  const bytes = new Bun.CryptoHasher('md5').update(`OfflinePlayer:${name}`).digest()
  bytes[6] = (bytes[6]! & 0x0f) | 0x30
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return dashed(Buffer.from(bytes).toString('hex'))
}
