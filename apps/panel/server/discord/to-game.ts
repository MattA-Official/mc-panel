/**
 * Chat from Discord into the game. A message in a server's linked channel (the channel its
 * Discord chat webhook posts to) is shown to everyone in game with `tellraw`, as
 * `[Discord] name: message`.
 *
 * Only what people type comes through: bots, webhooks (including Flytower's own relay, so
 * nothing echoes) and system messages are left out. Mentions, channels and custom emoji are
 * turned into the names people see in Discord, Markdown markers are taken out, and the text is
 * cleaned and cut to length by `cleanMessage`, which also removes Minecraft's formatting codes.
 * The command is JSON built with JSON.stringify, so nothing typed can run a command.
 */
import { cleanMessage, tellraw } from './commands/staff'

/** The parts of a Discord message this needs. */
export interface DiscordMessage {
  id?: string
  channel_id: string
  guild_id?: string
  type?: number
  content?: string
  webhook_id?: string
  author?: { id?: string; username?: string; global_name?: string | null; bot?: boolean }
  member?: { nick?: string | null }
  mentions?: {
    id: string
    username?: string
    global_name?: string | null
    member?: { nick?: string | null }
  }[]
  attachments?: { content_type?: string | null }[]
  sticker_items?: unknown[]
  embeds?: unknown[]
}

/** Default messages and replies; everything else (joins, pins, boosts) is Discord's own. */
const PEOPLE_TYPES = new Set([0, 19])

/** The longest message shown in game, after cleaning. */
export const MESSAGE_MAX = 256

/** Whether a message is someone typing in a channel, rather than a bot, webhook or event. */
export function fromPerson(m: DiscordMessage): boolean {
  if (!m || typeof m.channel_id !== 'string' || !m.guild_id) return false
  if (m.webhook_id || m.author?.bot) return false
  return PEOPLE_TYPES.has(m.type ?? 0)
}

/** The name Discord shows for the sender in that server: nickname, display name, username. */
export function senderName(m: DiscordMessage): string {
  return (
    m.member?.nick?.trim() ||
    m.author?.global_name?.trim() ||
    m.author?.username?.trim() ||
    'Someone'
  )
}

function mentionName(m: DiscordMessage, id: string): string {
  const u = m.mentions?.find((x) => x.id === id)
  if (!u) return 'someone'
  return u.member?.nick?.trim() || u.global_name?.trim() || u.username?.trim() || 'someone'
}

function timestamp(seconds: string): string {
  const d = new Date(Number(seconds) * 1000)
  if (Number.isNaN(d.getTime())) return 'a time'
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Discord's markup turned into what people read in Discord, as plain text. */
export function plainText(m: DiscordMessage): string {
  // Escaped characters (`\*`) are set aside first, so they're never taken for Markdown.
  const kept: string[] = []
  let s = (m.content ?? '').replace(/\\([\\*_~`|>[\]()<#:@-])/g, (_, c: string) => {
    kept.push(c)
    return `\uE000${kept.length - 1}\uE001`
  })
  s = s
    // `<@123>` and `<@!123>`: the person's name.
    .replace(/<@!?(\d{5,25})>/g, (_, id: string) => `@${mentionName(m, id)}`)
    // Discord doesn't send role or channel names with a message.
    .replace(/<@&\d{5,25}>/g, '@role')
    .replace(/<#\d{5,25}>/g, '#channel')
    .replace(/<\/([\w-]+(?: [\w-]+){0,2}):\d{5,25}>/g, '/$1')
    .replace(/<a?:(\w{1,32}):\d{5,25}>/g, ':$1:')
    .replace(/<t:(-?\d{1,13})(?::[tTdDfFR])?>/g, (_, n: string) => timestamp(n))
    // Spoilers stay hidden.
    .replace(/\|\|[\s\S]+?\|\|/g, '[spoiler]')
    // Code blocks keep their text; the fences and language go.
    .replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, '$1')
    // Headings, quotes and small text at the start of a line.
    .replace(/^(?:#{1,3} |-# |>>> |> )/gm, '')
    // Masked links: `[text](url)` shows its text.
    .replace(/\[([^\]\n]{1,200})\]\(<?https?:\/\/[^\s)>]+>?\)/g, '$1')
    // Links Discord was told not to preview.
    .replace(/<(https?:\/\/[^\s>]+)>/g, '$1')
    // Bold, italics, underline, strikethrough and inline code.
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    // Single `*` and `_` only at word edges, so `snake_case` stays as typed.
    .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\2(?![\w*])/g, '$1$3')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\uE000(\d+)\uE001/g, (_, i: string) => kept[Number(i)] ?? '')
  return s
}

/** What's shown in game for a message, or null when there's nothing to show. */
export function gameMessage(m: DiscordMessage): string | null {
  let text = cleanMessage(plainText(m))
  if (!text) {
    const files = m.attachments ?? []
    if (files.length) {
      const images = files.every((f) => f.content_type?.startsWith('image/'))
      text = images
        ? files.length === 1
          ? '[sent an image]'
          : `[sent ${files.length} images]`
        : files.length === 1
          ? '[sent a file]'
          : `[sent ${files.length} files]`
    } else if (m.sticker_items?.length) {
      text = '[sent a sticker]'
    } else {
      return null
    }
  }
  return text.slice(0, MESSAGE_MAX)
}

/** The command that shows a Discord message in game, or null to show nothing. */
export function gameCommand(m: DiscordMessage): { command: string; line: string } | null {
  if (!fromPerson(m)) return null
  const text = gameMessage(m)
  if (!text) return null
  const from = cleanMessage(senderName(m)).slice(0, 40) || 'Someone'
  return { command: tellraw(from, text), line: `[Discord] ${from}: ${text}` }
}

export interface ToGameDeps {
  /** Servers taking chat from this channel. */
  targets: (channelId: string) => string[]
  running: (server: string) => Promise<boolean>
  /** Sends a console command over RCON, without echoing it. */
  command: (server: string, command: string) => Promise<unknown>
  /** Adds a line to the server's console in the panel (tellraw isn't in the log). */
  show: (server: string, line: string) => void
  log?: (message: string) => void
}

/** Most messages from Discord waiting for one server; more are dropped until it catches up. */
export const PENDING_MAX = 20

/**
 * Hands Discord messages to the game. Each server's messages go one at a time, in order, and a
 * flood beyond `PENDING_MAX` waiting is dropped rather than piling up behind a slow server.
 */
export class DiscordToGame {
  private chains = new Map<string, { tail: Promise<void>; pending: number }>()

  constructor(private deps: ToGameDeps) {}

  /** A message from the Gateway. */
  message(raw: unknown) {
    const m = raw as DiscordMessage
    if (!m || typeof m !== 'object' || typeof m.channel_id !== 'string') return
    const servers = this.deps.targets(m.channel_id)
    if (!servers.length) return
    const out = gameCommand(m)
    if (!out) return
    for (const server of servers) this.enqueue(server, out)
  }

  /** Resolves once every server has caught up. */
  async idle() {
    await Promise.all([...this.chains.values()].map((c) => c.tail))
  }

  private enqueue(server: string, out: { command: string; line: string }) {
    let c = this.chains.get(server)
    if (!c) this.chains.set(server, (c = { tail: Promise.resolve(), pending: 0 }))
    if (c.pending >= PENDING_MAX) return
    c.pending++
    const chain = c
    chain.tail = chain.tail.then(async () => {
      try {
        if (!(await this.deps.running(server))) return
        await this.deps.command(server, out.command)
        this.deps.show(server, out.line)
      } catch (err) {
        this.deps.log?.(
          `[flytower] Couldn’t show a Discord message on ${server}: ${(err as Error).message}`,
        )
      } finally {
        chain.pending--
      }
    })
  }
}
