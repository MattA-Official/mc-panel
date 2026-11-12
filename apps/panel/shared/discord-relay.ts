/**
 * Game chat to Discord: a server's chat, joins and leaves posted to a Discord channel through
 * the channel's webhook. Shared by the settings card, its API and the relay itself.
 */
import { z } from 'zod'

/** What's stored on the server's row. The webhook URL holds Discord's token, so it's sealed. */
export interface StoredRelay {
  urlSealed: string
  /** The URL with its token hidden, for telling webhooks apart. */
  target: string
  chat: boolean
  joins: boolean
  /** Missing on relays saved before deaths and advancements were added: those count as on. */
  deaths?: boolean
  advancements?: boolean
  /** Why Discord refused the last message, if it did. */
  lastError: string | null
  lastErrorAt: number | null
  /** Discord said the webhook is gone or refused it: nothing is sent until it's saved again. */
  broken: boolean
  /** Messages in the webhook's channel are shown in game. Missing means off. */
  fromDiscord?: boolean
  /** The webhook's channel and Discord server, read from Discord when chat from Discord is on. */
  channelId?: string | null
  guildId?: string | null
}

/** What the browser sees: never the URL. */
export interface RelayView {
  configured: boolean
  target: string | null
  chat: boolean
  joins: boolean
  deaths: boolean
  advancements: boolean
  lastError: string | null
  lastErrorAt: number | null
  broken: boolean
  fromDiscord: boolean
  /** The panel-wide connection chat from Discord needs, and whether the bot can see the channel. */
  inbound: InboundView
}

/** How chat from Discord stands for a server's channel. */
export interface InboundView {
  /** Whether "Chat from Discord" is on for the whole panel (System, Integrations). */
  enabled: boolean
  state: 'off' | 'connecting' | 'connected' | 'reconnecting' | 'stopped'
  error: string | null
  /** Whether the bot is in the channel's Discord server; null when that isn't known yet. */
  botInServer: boolean | null
}

export const INBOUND_OFF: InboundView = {
  enabled: false,
  state: 'off',
  error: null,
  botInServer: null,
}

export const OFF: RelayView = {
  configured: false,
  target: null,
  chat: true,
  joins: true,
  deaths: true,
  advancements: true,
  lastError: null,
  lastErrorAt: null,
  broken: false,
  fromDiscord: false,
  inbound: INBOUND_OFF,
}

/**
 * The relay as the browser sees it. `inbound` says how chat from Discord stands for a guild,
 * from the panel's Gateway connection; leave it out where that doesn't matter.
 */
export function relayView(
  raw: unknown,
  inbound?: (guildId: string | null) => InboundView,
): RelayView {
  const s = raw as Partial<StoredRelay> | null | undefined
  if (!s || typeof s.urlSealed !== 'string') {
    return { ...OFF, inbound: inbound?.(null) ?? INBOUND_OFF }
  }
  return {
    configured: true,
    target: typeof s.target === 'string' ? s.target : null,
    chat: s.chat !== false,
    joins: s.joins !== false,
    deaths: s.deaths !== false,
    advancements: s.advancements !== false,
    lastError: typeof s.lastError === 'string' ? s.lastError : null,
    lastErrorAt: typeof s.lastErrorAt === 'number' ? s.lastErrorAt : null,
    broken: s.broken === true,
    fromDiscord: s.fromDiscord === true,
    inbound: inbound?.(typeof s.guildId === 'string' ? s.guildId : null) ?? INBOUND_OFF,
  }
}

/** Saving: leave the URL out to keep the one that's stored. */
export const RelayInput = z
  .object({
    url: z.string().trim().url('That isn’t a web address.').max(500).optional(),
    chat: z.boolean().default(true),
    joins: z.boolean().default(true),
    deaths: z.boolean().default(true),
    advancements: z.boolean().default(true),
    /** Show messages from the webhook's channel in game. Needs chat from Discord turned on. */
    fromDiscord: z.boolean().default(false),
  })
  .strict()
export type RelayInput = z.output<typeof RelayInput>
