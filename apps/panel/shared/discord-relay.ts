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
  /** Why Discord refused the last message, if it did. */
  lastError: string | null
  lastErrorAt: number | null
  /** Discord said the webhook is gone or refused it: nothing is sent until it's saved again. */
  broken: boolean
}

/** What the browser sees: never the URL. */
export interface RelayView {
  configured: boolean
  target: string | null
  chat: boolean
  joins: boolean
  lastError: string | null
  lastErrorAt: number | null
  broken: boolean
}

export const OFF: RelayView = {
  configured: false,
  target: null,
  chat: true,
  joins: true,
  lastError: null,
  lastErrorAt: null,
  broken: false,
}

export function relayView(raw: unknown): RelayView {
  const s = raw as Partial<StoredRelay> | null | undefined
  if (!s || typeof s.urlSealed !== 'string') return { ...OFF }
  return {
    configured: true,
    target: typeof s.target === 'string' ? s.target : null,
    chat: s.chat !== false,
    joins: s.joins !== false,
    lastError: typeof s.lastError === 'string' ? s.lastError : null,
    lastErrorAt: typeof s.lastErrorAt === 'number' ? s.lastErrorAt : null,
    broken: s.broken === true,
  }
}

/** Saving: leave the URL out to keep the one that's stored. */
export const RelayInput = z
  .object({
    url: z.string().trim().url('That isn’t a web address.').max(500).optional(),
    chat: z.boolean().default(true),
    joins: z.boolean().default(true),
  })
  .strict()
export type RelayInput = z.output<typeof RelayInput>
