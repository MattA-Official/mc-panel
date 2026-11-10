/**
 * Chat from the panel's console. Over RCON the game calls the sender "Rcon", so `/say hi` shows
 * as `[Rcon] hi` and `/msg Steve hi` as "Rcon whispers to you". These commands are sent as a
 * `tellraw` instead, under a proper label: `[Server] Matt: hi`, with the tag in the brand colour.
 *
 * The text is JSON built with JSON.stringify, so nothing typed can close the string, add click
 * events or run a command. `tellraw` isn't written to the server log, so the console shows the
 * line itself and the Discord relay is handed it directly.
 */
import type { RelayLine } from '../discord/relay'

/** The tag in front of console chat. */
export const SERVER_TAG = '[Server]'

export interface ChatRewrite {
  /** The command to send instead. */
  command: string
  /** What the console shows for it: the line, or the game's reply when it refused. */
  shown: (reply: string) => string[]
  /** The line for the Discord chat relay, for chat everyone sees, once the game took it. */
  relay?: RelayLine
}

const CHAT = /^(say|me|msg|tell|w)\s+([\s\S]+)$/i

/** Formatting codes and control characters can't come through. */
function clean(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/§/g, '')
    .trim()
}

/** The first argument of `/msg`: a name, or a selector like `@a[distance=..10, limit=1]`. */
export function splitTarget(rest: string): { target: string; message: string } | null {
  let i = 0
  if (rest.startsWith('@') && rest[2] === '[') {
    let depth = 0
    let quote: string | null = null
    for (i = 2; i < rest.length; i++) {
      const c = rest[i]!
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) {
        i++
        break
      }
    }
    if (depth !== 0) return null
  } else {
    while (i < rest.length && !/\s/.test(rest[i]!)) i++
  }
  const target = rest.slice(0, i)
  const message = rest.slice(i).trim()
  return target && message && /^\s/.test(rest.slice(i)) ? { target, message } : null
}

/**
 * The `tellraw` for a console `/say`, `/me` or `/msg` (and its `/tell` and `/w` aliases), or
 * null for any other command, which goes through as typed. `sender` is the signed-in person's
 * name, or null for the panel itself (a scheduled task), which shows as the tag alone.
 */
export function rewriteChat(
  command: string,
  sender: string | null,
  colour = 'gold',
): ChatRewrite | null {
  const m = CHAT.exec(command.trim())
  if (!m) return null
  const verb = m[1]!.toLowerCase()
  const who = sender ? clean(sender).slice(0, 40) || null : null
  const tag = { text: `${SERVER_TAG} `, color: colour }

  if (verb === 'say') {
    const text = clean(m[2]!)
    if (!text) return null
    const parts = ['', tag, ...(who ? [{ text: `${who}: `, color: 'gray' }] : []), { text }]
    const line = `${SERVER_TAG} ${who ? `${who}: ` : ''}${text}`
    return {
      command: `tellraw @a ${JSON.stringify(parts)}`,
      shown: (reply) => (reply.trim() ? reply.split('\n') : [line]),
      relay: { kind: 'chat', player: who ?? 'Server', text, console: true },
    }
  }

  if (verb === 'me') {
    const text = clean(m[2]!)
    if (!text) return null
    const name = who ?? 'Server'
    const parts = ['', tag, { text: `* ${name} ${text}` }]
    return {
      command: `tellraw @a ${JSON.stringify(parts)}`,
      shown: (reply) => (reply.trim() ? reply.split('\n') : [`${SERVER_TAG} * ${name} ${text}`]),
      relay: { kind: 'chat', player: name, text, emote: true, console: true },
    }
  }

  // msg, tell, w
  const split = splitTarget(m[2]!)
  if (!split) return null
  const text = clean(split.message)
  if (!text) return null
  const name = who ? `${SERVER_TAG} ${who}` : SERVER_TAG
  const whisper = { text: `${name} whispers to you: ${text}`, color: 'gray', italic: true }
  return {
    command: `tellraw ${split.target} ${JSON.stringify(whisper)}`,
    // An empty reply means it went; otherwise it's the game saying why not (no such player).
    shown: (reply) =>
      reply.trim() ? reply.split('\n') : [`You whisper to ${split.target}: ${text}`],
  }
}
