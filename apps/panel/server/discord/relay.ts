/**
 * Game chat to Discord. Each server's chat, joins, leaves, deaths and advancements come from the
 * log watcher (inotify, so nothing polls) and are posted to the server's Discord channel webhook
 * as plain text under the player's name, with their head as the avatar.
 *
 * Nothing a player types can ping anyone or format the message: every post has
 * `allowed_mentions: { parse: [] }`, Markdown is escaped and link previews are off.
 *
 * Posting is one message at a time per server, waiting whenever Discord's rate-limit headers
 * say the bucket is empty. Lines that pile up meanwhile are joined: one player's lines in a
 * row become one message, and a big backlog becomes a single message listing everyone's lines,
 * so a busy chat is slowed down rather than dropped.
 */
import { isDiscordWebhook } from '../notify/discord'
import { DEATH_MESSAGES } from './death-messages'
import { DeliveryError, postJson } from '../notify/types'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** A line worth relaying. `player` is the name as the log shows it. */
export type RelayLine =
  /** `console` is chat sent from the panel's console: `player` is the person, not a player. */
  | { kind: 'chat'; player: string; text: string; emote?: boolean; console?: boolean }
  | { kind: 'joined' | 'left'; player: string }
  /** `text` follows the player's name; `whole` is set when the name isn't first, so it's all of it. */
  | { kind: 'death' | 'advancement'; player: string; text: string; whole?: boolean }

// The log prefix, as in notify/watchers.ts: vanilla and Fabric `[12:34:56] [Server thread/INFO]: `,
// Paper `[12:34:56 INFO]: `. Unsigned chat is logged as `[Not Secure] <Steve> hi`, and mods that
// turn chat into system messages (No Chat Reports) make it `System chat: <Steve> hi` on 26.x.
const PREFIX = /^\[[^\]]*\](?: \[[^\]]*\])?: (?:System chat: )?(?:\[Not Secure\] )?(.*)$/
// `<Steve> hi`. The name is the first `<…>`, so `<Bob> <Steve> hi` is Bob saying "<Steve> hi".
// Teams can decorate the name (`<[Red] Steve> hi`), so anything up to 64 characters is taken.
const CHAT = /^<([^<>]{1,64})> (.+)$/
// `/me waves` is logged as `* Steve waves`.
const EMOTE = /^\* ([.*]?[A-Za-z0-9_]{1,16}) (.+)$/
const ACTIVITY = /^([.*]?[A-Za-z0-9_]{1,16}) (joined|left) the game$/
const NAME = /^[.*]?[A-Za-z0-9_]{1,16}$/
const NAME_GROUP = '([.*]?[A-Za-z0-9_]{1,16})'
// `Steve has made the advancement [Stone Age]`, `… has reached the goal […]`, `… has completed
// the challenge […]`.
const ADVANCEMENT = new RegExp(
  `^${NAME_GROUP} (has (?:made the advancement|reached the goal|completed the challenge) \\[.+\\])$`,
)

/** Each death message as a pattern: the dead player captured, the killer and item anything. */
const DEATHS: RegExp[] = DEATH_MESSAGES.map((t) => {
  const parts = t.split(/(%[123]\$s)/)
  const body = parts
    .map((p) =>
      p === '%1$s'
        ? NAME_GROUP
        : /^%[23]\$s$/.test(p)
          ? '.+?'
          : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  return new RegExp(`^${body}$`)
})

/** A death message's player, or null. Deaths are system messages players can't write. */
export function parseDeath(msg: string): RelayLine | null {
  for (const re of DEATHS) {
    const m = re.exec(msg)
    if (!m) continue
    const player = m[1]!
    return msg.startsWith(`${player} `)
      ? { kind: 'death', player, text: msg.slice(player.length + 1) }
      : { kind: 'death', player, text: msg, whole: true }
  }
  return null
}

/** What a log line says that's worth posting, or null. */
export function parseRelayLine(line: string): RelayLine | null {
  const m = PREFIX.exec(line.trimEnd())
  if (!m) return null
  const msg = m[1]!
  const chat = CHAT.exec(msg)
  if (chat) return { kind: 'chat', player: chat[1]!.trim(), text: chat[2]! }
  const a = ACTIVITY.exec(msg)
  if (a) return { kind: a[2] === 'joined' ? 'joined' : 'left', player: a[1]! }
  const e = EMOTE.exec(msg)
  if (e) return { kind: 'chat', player: e[1]!, text: e[2]!, emote: true }
  const adv = ADVANCEMENT.exec(msg)
  if (adv) return { kind: 'advancement', player: adv[1]!, text: adv[2]! }
  return parseDeath(msg)
}

/** The account name inside a decorated display name like `[Red] Steve`, if there is one. */
export function accountName(display: string): string | null {
  if (NAME.test(display)) return display
  const last = display.split(/\s+/).at(-1) ?? ''
  return NAME.test(last) ? last : null
}

const URL_IN_TEXT = /https?:\/\/[^\s<>]+/g

/**
 * Text from the game, made safe for Discord: Markdown, headings, lists, quotes, masked links,
 * mentions, channel links, timestamps and custom emoji all show as typed. Web addresses are
 * left whole (in `<…>`, which also stops a preview) so they still work as links.
 */
export function escapeChat(s: string): string {
  const esc = (t: string) => t.replace(/([\\*_~`|>[\]()<#:@-])/g, '\\$1')
  let out = ''
  let at = 0
  for (const m of s.matchAll(URL_IN_TEXT)) {
    out += esc(s.slice(at, m.index)) + `<${m[0]}>`
    at = m.index + m[0].length
  }
  return out + esc(s.slice(at))
}

// ------------------------------------------------------------------ payloads

/** Discord's own limits. */
export const CONTENT_MAX = 2000
const USERNAME_MAX = 80
/** Messages with link previews turned off. */
const SUPPRESS_EMBEDS = 1 << 2

/** Discord refuses webhook names that mention it or its old bot, Clyde. */
export function allowedUsername(name: string): boolean {
  return !!name.trim() && !/discord|clyde|```/i.test(name) && !/^(everyone|here)$/i.test(name)
}

export interface Post {
  username?: string
  avatar_url?: string
  content?: string
  allowed_mentions: { parse: [] }
  flags: number
}

/** A queued line with what it needs to be posted. */
export interface Item {
  line: RelayLine
  /** The player's head, or null if the panel has no public address to serve it from. */
  avatar: string | null
  /** Settles once `avatar` has been looked up. */
  ready?: Promise<unknown>
}

/** A line's text: what they said, or `joined the game` / `left the game`. */
function lineText(i: Item): string {
  const l = i.line
  if (l.kind === 'chat') return l.emote ? `_${escapeChat(l.text)}_` : escapeChat(l.text)
  if (l.kind === 'death' || l.kind === 'advancement') return escapeChat(l.text)
  return l.kind === 'joined' ? 'joined the game' : 'left the game'
}

/** Who a line is from as Discord shows it: the player, or `[Server] Matt` for console chat. */
export function senderName(l: RelayLine): string {
  return l.kind === 'chat' && l.console ? `[Server] ${l.player}` : l.player
}

/** As posted under the player's name: everything but chat in italics, so it reads as an event. */
function ownLine(i: Item): string {
  return i.line.kind === 'chat' ? lineText(i) : `_${lineText(i)}_`
}

/** As posted under someone else's name: `**Steve**: hi`, or `**Steve** joined the game`. */
function namedLine(i: Item): string {
  const who = `**${escapeChat(senderName(i.line))}**`
  if (i.line.kind === 'chat') return `${who}: ${lineText(i)}`
  // `Bob showed Steve that not just the floor is lava` already says who.
  if (i.line.kind === 'death' && i.line.whole) return `_${lineText(i)}_`
  return `_${who} ${lineText(i)}_`
}

/**
 * One player's lines in a row (chat, joins, leaves, deaths, advancements), posted as them with their head, all in
 * plain text like the rest of the relay.
 */
export function playerPost(items: Item[]): Post {
  const first = items[0]!
  const player = senderName(first.line)
  const body = items.map(ownLine).join('\n')
  if (allowedUsername(player)) {
    return {
      username: player.slice(0, USERNAME_MAX),
      ...(first.avatar && { avatar_url: first.avatar }),
      content: body.slice(0, CONTENT_MAX),
      allowed_mentions: { parse: [] },
      flags: SUPPRESS_EMBEDS,
    }
  }
  // A name Discord won't take: post under the webhook's own name, with theirs in the text.
  return {
    content: items.map(namedLine).join('\n').slice(0, CONTENT_MAX),
    allowed_mentions: { parse: [] },
    flags: SUPPRESS_EMBEDS,
  }
}

/** A backlog as one message under the webhook's own name: `**Steve**: hi`, one a line. */
export function digestPost(items: Item[], skipped = 0): Post {
  const lines: string[] = []
  if (skipped) lines.push(`_…${skipped} earlier line${skipped === 1 ? '' : 's'} not sent_`)
  for (const i of items) lines.push(namedLine(i))
  let content = ''
  for (const l of lines) {
    if (content.length + l.length + 1 > CONTENT_MAX) break
    content += (content ? '\n' : '') + l
  }
  return { content, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS }
}

/** More lines than this waiting, and they're sent as one digest. */
export const DIGEST_AT = 5
/** Lines kept waiting per server; older ones are counted and left out. */
export const QUEUE_MAX = 200

/**
 * The next message to send from the front of the queue, and how many lines it takes. A digest
 * takes as many lines as fit; anything else takes one player's lines in a row.
 */
export function nextPost(queue: Item[], skipped = 0): { post: Post; take: number } {
  if (queue.length > DIGEST_AT || skipped) {
    let take = 0
    let size = skipped ? 40 : 0
    for (const i of queue) {
      const n = senderName(i.line).length + lineText(i).length + 12
      if (take && size + n > CONTENT_MAX) break
      size += n
      take++
    }
    return { post: digestPost(queue.slice(0, take), skipped), take }
  }
  const first = queue[0]!
  let take = 1
  let size = ownLine(first).length
  while (take < queue.length) {
    const next = queue[take]!
    if (senderName(next.line) !== senderName(first.line)) break
    size += ownLine(next).length + 1
    if (size > CONTENT_MAX) break
    take++
  }
  return { post: playerPost(queue.slice(0, take)), take }
}

/** How long Discord says to wait before the next request, from a response's headers. */
export function waitFromHeaders(res: Response): number {
  const remaining = Number(res.headers.get('x-ratelimit-remaining'))
  const reset = Number(res.headers.get('x-ratelimit-reset-after'))
  if (res.headers.get('x-ratelimit-remaining') !== null && remaining <= 0 && reset > 0) {
    return Math.ceil(reset * 1000)
  }
  return 0
}

// ------------------------------------------------------------------ the webhook's channel

/**
 * The channel and Discord server a webhook posts to. Reading a webhook with its token needs
 * no bot token. Throws a DeliveryError saying what's wrong.
 */
export async function webhookChannel(
  url: string,
  fetchImpl: Fetch = fetch,
): Promise<{ channelId: string; guildId: string | null }> {
  if (!isDiscordWebhook(url)) {
    throw new DeliveryError("That isn't a Discord webhook address.", null, true)
  }
  let res: Response
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  } catch (err) {
    throw new DeliveryError(`Couldn't reach Discord: ${(err as Error).message}`)
  }
  if (res.status === 401 || res.status === 404) {
    throw new DeliveryError('Discord says that webhook doesn’t exist any more.', null, true)
  }
  if (!res.ok) throw new DeliveryError(`Discord answered ${res.status}.`)
  const body = (await res.json().catch(() => null)) as {
    channel_id?: unknown
    guild_id?: unknown
  } | null
  const snowflake = (v: unknown) => (typeof v === 'string' && /^\d{5,25}$/.test(v) ? v : null)
  const channelId = snowflake(body?.channel_id)
  if (!channelId) throw new DeliveryError('Discord didn’t say which channel the webhook is in.')
  return { channelId, guildId: snowflake(body?.guild_id) }
}

// ------------------------------------------------------------------ the relay

export interface RelayConfig {
  url: string
  chat: boolean
  joins: boolean
  deaths: boolean
  advancements: boolean
}

/** Whether a server's relay posts this kind of line. */
export function wants(config: RelayConfig, line: RelayLine): boolean {
  switch (line.kind) {
    case 'chat':
      return config.chat
    case 'joined':
    case 'left':
      return config.joins
    case 'death':
      return config.deaths
    case 'advancement':
      return config.advancements
  }
}

export interface RelayDeps {
  /** The server's relay, unsealed, or null if it's off (or broken). */
  config: (server: string) => Promise<RelayConfig | null>
  /** A public address for the player's head, or null. */
  avatar: (server: string, player: string) => Promise<string | null>
  /** Discord refused a message; `permanent` means the webhook is gone or the token is wrong. */
  failed: (server: string, message: string, permanent: boolean) => void
  /** The last message went through after a failure. */
  recovered?: (server: string) => void
  fetch?: Fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Tries for one message before it's given up on (rate limits don't count). */
const ATTEMPTS = 3
const BACKOFF_MS = [2_000, 10_000]

interface Queue {
  items: Item[]
  skipped: number
  running: Promise<void> | null
  /** Don't send before this time (ms), from Discord's rate-limit headers. */
  until: number
  /** A failure was reported and nothing has gone through since. */
  failing: boolean
}

export class ChatRelay {
  private queues = new Map<string, Queue>()
  private fetch: Fetch
  private now: () => number
  private sleep: (ms: number) => Promise<void>

  constructor(private deps: RelayDeps) {
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  /** A new log line from a server. */
  line(server: string, raw: string) {
    const line = parseRelayLine(raw)
    if (line) void this.offer(server, line)
  }

  /** Queues a line if the server relays that kind, and starts sending. */
  async offer(server: string, line: RelayLine) {
    const config = await this.deps.config(server)
    if (!config) return
    if (!wants(config, line)) return
    // Queued at once so lines stay in the order they were said; the head is looked up meanwhile.
    const q = this.queue(server)
    const item: Item = { line, avatar: null }
    // Console chat is from a person, not a player, so it has no head (and a player who happens
    // to share their name mustn't lend them one).
    const fromConsole = line.kind === 'chat' && line.console
    item.ready = (fromConsole ? Promise.resolve(null) : this.deps.avatar(server, line.player))
      .then((url) => (item.avatar = url))
      .catch(() => null)
    q.items.push(item)
    if (q.items.length > QUEUE_MAX) {
      q.skipped += q.items.length - QUEUE_MAX
      q.items.splice(0, q.items.length - QUEUE_MAX)
    }
    this.kick(server)
  }

  /** Lines waiting for a server. */
  waiting(server: string): number {
    return this.queues.get(server)?.items.length ?? 0
  }

  /** Drops what's waiting for a server, after its relay is turned off or changed. */
  clear(server: string) {
    const q = this.queues.get(server)
    if (q) {
      q.items = []
      q.skipped = 0
    }
  }

  /** Resolves once nothing is being sent. */
  async idle() {
    await Promise.all([...this.queues.values()].map((q) => q.running))
  }

  /**
   * Sends one test message as the webhook's own name, straight away. Throws a DeliveryError
   * saying what's wrong.
   */
  async test(url: string, text: string) {
    if (!isDiscordWebhook(url)) {
      throw new DeliveryError("That isn't a Discord webhook address.", null, true)
    }
    await postJson(
      this.fetch,
      url,
      { content: text, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS },
      {},
      'Discord',
    )
  }

  private queue(server: string): Queue {
    let q = this.queues.get(server)
    if (!q)
      this.queues.set(
        server,
        (q = { items: [], skipped: 0, running: null, until: 0, failing: false }),
      )
    return q
  }

  private kick(server: string) {
    const q = this.queue(server)
    q.running ??= this.drain(server, q).finally(() => {
      q.running = null
      if (q.items.length) this.kick(server)
    })
  }

  private async drain(server: string, q: Queue) {
    while (q.items.length) {
      await Promise.all(q.items.slice(0, CONTENT_MAX).map((i) => i.ready))
      if (!q.items.length) return
      // Taken off the queue now, so lines dropped from a long queue meanwhile can't shift it.
      const { post, take } = nextPost(q.items, q.skipped)
      q.items.splice(0, take)
      q.skipped = 0
      if (!(await this.send(server, q, post))) return
    }
  }

  /** Sends one message, retrying as needed. False if the relay stopped (off, or refused). */
  private async send(server: string, q: Queue, post: Post): Promise<boolean> {
    for (let attempt = 0; ;) {
      const wait = q.until - this.now()
      if (wait > 0) await this.sleep(wait)
      const config = await this.deps.config(server)
      if (!config) {
        this.clear(server)
        return false
      }
      try {
        const res = await postJson(this.fetch, config.url, post, {}, 'Discord')
        q.until = this.now() + waitFromHeaders(res)
        if (q.failing) {
          q.failing = false
          this.deps.recovered?.(server)
        }
        return true
      } catch (err) {
        const e =
          err instanceof DeliveryError ? err : new DeliveryError(String((err as Error).message))
        if (e.retryAfterMs !== null) {
          // Rate limited: wait as long as Discord asked and send the same message again.
          q.until = this.now() + e.retryAfterMs
          continue
        }
        if (e.permanent) {
          this.deps.failed(server, e.message, true)
          this.clear(server)
          return false
        }
        if (attempt >= ATTEMPTS - 1) {
          q.failing = true
          this.deps.failed(server, e.message, false)
          return true
        }
        q.until = this.now() + BACKOFF_MS[attempt]!
        attempt++
      }
    }
  }
}
