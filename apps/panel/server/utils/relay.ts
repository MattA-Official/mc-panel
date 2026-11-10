import { deriveSecret } from 'nuxt/server'
import { uuidHex } from '@flytower/providers'
import { eq } from 'drizzle-orm'
import { sealer } from '../backups/offsite'
import { schema } from '../db'
import { ChatRelay, accountName, type RelayConfig } from '../discord/relay'
import { checkUrl, maskUrl, NotifyError } from '../notify'
import { parseUuidLine } from '../stats/sessions'
import {
  relayView,
  type RelayInput,
  type RelayView,
  type StoredRelay,
} from '../../shared/discord-relay'

const seal = sealer(() => deriveSecret('flytower:discord-relay'))

/** Unsealed relay settings by server, as promises so lines keep their order while one loads. */
const configs = new Map<string, Promise<RelayConfig | null>>()

function stored(server: string): StoredRelay | null {
  return (
    useDb()
      .select({ r: schema.servers.discordRelay })
      .from(schema.servers)
      .where(eq(schema.servers.name, server))
      .get()?.r ?? null
  )
}

function relayConfig(server: string): Promise<RelayConfig | null> {
  let c = configs.get(server)
  if (!c) {
    c = (async () => {
      const s = stored(server)
      if (!s || s.broken) return null
      return {
        url: await seal.unseal(s.urlSealed),
        chat: s.chat,
        joins: s.joins,
        deaths: s.deaths !== false,
        advancements: s.advancements !== false,
      }
    })().catch((err) => {
      console.error(`[flytower] can't read ${server}'s Discord chat settings`, err)
      return null
    })
    configs.set(server, c)
  }
  return c
}

function writeStored(server: string, next: StoredRelay | null) {
  useDb()
    .update(schema.servers)
    .set({ discordRelay: next })
    .where(eq(schema.servers.name, server))
    .run()
  configs.delete(server)
}

/** UUIDs from the log's login lines, by server and lower-case name: the quickest way to a head. */
const uuids = new Map<string, Map<string, string>>()

function rememberUuid(server: string, line: string) {
  const p = parseUuidLine(line)
  if (!p) return
  let m = uuids.get(server)
  if (!m) uuids.set(server, (m = new Map()))
  m.set(p.name.toLowerCase(), p.uuid)
  if (m.size > 1000) m.delete(m.keys().next().value!)
}

function origin(): string | null {
  const { rpId } = useRuntimeConfig()
  return rpId ? `https://${rpId}` : null
}

const headKey = () => deriveSecret('flytower:player-heads')

/** The signature in a head's address, so the address can't be used to look up any player. */
export async function headSignature(uuid: string): Promise<string> {
  const hex = uuidHex(uuid) ?? uuid
  return new Bun.CryptoHasher('sha256', await headKey()).update(hex).digest('hex').slice(0, 24)
}

async function avatar(server: string, display: string): Promise<string | null> {
  const base = origin()
  const name = accountName(display)
  if (!base || !name) return null
  const uuid = uuids.get(server)?.get(name.toLowerCase()) ?? (await lookupPlayerUuid(server, name))
  if (!uuid) return null
  return `${base}/api/public/heads/${uuid}.png?s=${await headSignature(uuid)}`
}

let relay: ChatRelay | undefined

/** Posts every server's chat, joins and leaves to its Discord channel, if it has one. */
export function useChatRelay(): ChatRelay {
  if (relay) return relay
  relay = new ChatRelay({
    config: relayConfig,
    avatar,
    failed: (server, message, permanent) => {
      const s = stored(server)
      if (!s) return
      writeStored(server, {
        ...s,
        lastError: message,
        lastErrorAt: Date.now(),
        broken: s.broken || permanent,
      })
      console.error(`[flytower] Discord chat for ${server}: ${message}`)
    },
    recovered: (server) => {
      const s = stored(server)
      if (s?.lastError) writeStored(server, { ...s, lastError: null, lastErrorAt: null })
    },
  })
  const r = relay
  useLogWatcher().listenLines((server, line) => {
    rememberUuid(server, line)
    // Only servers with a relay go further than this map look-up.
    r.line(server, line)
  })
  return relay
}

export function relayHttpError(err: unknown): never {
  if (err instanceof NotifyError) throw createError({ statusCode: 400, statusMessage: err.message })
  throw err
}

/**
 * Saves a server's relay. A new URL is checked and sealed; leaving it out keeps the stored one
 * (and is refused when there isn't one). Saving clears a past failure and turns it back on.
 */
export async function saveRelay(server: string, input: RelayInput): Promise<RelayView> {
  const was = stored(server)
  let urlSealed = was?.urlSealed
  let target = was?.target
  if (input.url) {
    try {
      checkUrl('discord', input.url)
    } catch (err) {
      relayHttpError(err)
    }
    urlSealed = await seal.seal(input.url)
    target = maskUrl('discord', input.url)
  }
  if (!urlSealed || !target) {
    throw createError({ statusCode: 400, statusMessage: 'Paste the channel’s webhook URL.' })
  }
  const next: StoredRelay = {
    urlSealed,
    target,
    chat: input.chat,
    joins: input.joins,
    deaths: input.deaths,
    advancements: input.advancements,
    lastError: null,
    lastErrorAt: null,
    broken: false,
  }
  writeStored(server, next)
  useChatRelay().clear(server)
  return relayView(next)
}

export function removeRelay(server: string) {
  writeStored(server, null)
  relay?.clear(server)
}

/** Forgets a deleted server, so a new one with its name starts with no relay. */
export function forgetRelay(server: string) {
  configs.delete(server)
  uuids.delete(server)
  relay?.clear(server)
}

/** The URL to test with: the one given, or the stored one. */
export async function relayTestUrl(server: string, url?: string): Promise<string> {
  if (url) return url
  const s = stored(server)
  if (!s) throw createError({ statusCode: 400, statusMessage: 'Paste the channel’s webhook URL.' })
  return seal.unseal(s.urlSealed)
}
