/**
 * /status and /players: answered from the same roster and rules as the public status page,
 * so the server is never asked and the page's show settings (names, count or nothing, and
 * the version) apply in Discord too.
 */
import { can, type Access } from '../../../shared/permissions'
import type { PublicStatus } from '../../../shared/public-page'
import { COLOURS, escapeMarkdown } from '../../notify/discord'
import {
  OptionType,
  type Choice,
  type CommandContext,
  type DiscordCommand,
  type Reply,
} from '../registry'

export interface ServerEntry {
  name: string
  displayName: string
  /** The server's public page is on. */
  public: boolean
}

export interface ServerSource {
  servers(): ServerEntry[]
  /** The server's status as its public page would show it. */
  status(name: string): Promise<PublicStatus>
  /** The panel's https origin, for icon links; null without a domain. */
  origin(): string | null
}

/** Discord waits 3 seconds for an answer; leave room for the trip back. */
export const DEADLINE_MS = 2500

/** Servers the caller may see: public ones, and any they can see in Flytower. */
export function visibleServers(source: ServerSource, access: Access): ServerEntry[] {
  return source
    .servers()
    .filter((s) => s.public || can(access, 'server.view', s.name))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function serverChoices(servers: ServerEntry[], typed: string): Choice[] {
  const q = typed.trim().toLowerCase()
  return servers
    .filter((s) => !q || s.name.includes(q) || s.displayName.toLowerCase().includes(q))
    .slice(0, 25)
    .map((s) => ({ name: s.displayName.slice(0, 100), value: s.name }))
}

const STATE = {
  online: { label: 'Online', colour: COLOURS.ok },
  starting: { label: 'Starting', colour: COLOURS.warning },
  offline: { label: 'Offline', colour: COLOURS.critical },
} as const

function playersLine(s: PublicStatus): string | null {
  if (!s.players) return null
  const max = s.players.max !== null ? ` of ${s.players.max}` : ''
  return `${s.players.count}${max}`
}

function absolute(origin: string | null, url: string | null): string | null {
  return origin && url?.startsWith('/') ? `${origin}${url}` : null
}

export function statusEmbed(s: PublicStatus, origin: string | null) {
  const fields = [
    { name: 'Status', value: STATE[s.state].label, inline: true },
    { name: 'Address', value: `\`${s.address}\``, inline: true },
  ]
  const players = playersLine(s)
  if (players && s.state === 'online')
    fields.push({ name: 'Players', value: players, inline: true })
  if (s.version) {
    fields.push({
      name: 'Version',
      value: `${s.version.loader} ${s.version.minecraft}`,
      inline: true,
    })
  }
  const map = absolute(origin, s.map?.url ?? null)
  if (map) fields.push({ name: 'Map', value: `[Open the map](${map})`, inline: true })
  const icon = absolute(origin, s.icon)
  return {
    title: s.displayName.slice(0, 256),
    color: STATE[s.state].colour,
    ...(s.description && { description: escapeMarkdown(s.description).slice(0, 1000) }),
    fields,
    ...(icon && { thumbnail: { url: icon } }),
  }
}

export function playersText(s: PublicStatus): string {
  const name = `**${escapeMarkdown(s.displayName)}**`
  if (s.state !== 'online') return `${name} is ${STATE[s.state].label.toLowerCase()}.`
  if (!s.players) return `${name} doesn't share who's on.`
  const count = playersLine(s)!
  if (s.players.count === 0) return `${name}: nobody's on.`
  if (!s.players.list) return `${name}: ${count} online.`
  const names = s.players.list.map((p) => escapeMarkdown(p.name)).join(', ')
  return `${name}: ${count} online: ${names}`
}

/** Runs `work`, or answers privately that it's still checking if it takes too long. */
async function inTime(work: Promise<Reply>, ms: number): Promise<Reply> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Reply>((resolve) => {
    timer = setTimeout(
      () => resolve({ content: 'Still checking. Try again in a moment.', ephemeral: true }),
      ms,
    )
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

const SERVER_OPTION = {
  type: OptionType.String,
  name: 'server',
  description: 'Which server. Leave it out for all of them.',
  autocomplete: true,
} as const

/** The server asked for, or every visible one; null with a message when that's none. */
function pick(source: ServerSource, ctx: CommandContext): ServerEntry[] | Reply {
  const visible = visibleServers(source, ctx.access)
  const asked = ctx.options.server
  if (typeof asked === 'string' && asked) {
    const q = asked.trim().toLowerCase()
    const found = visible.find((s) => s.name === q || s.displayName.toLowerCase() === q)
    // A server the caller can't see answers the same as one that doesn't exist.
    return found
      ? [found]
      : { content: `There's no server called “${asked.slice(0, 40)}”.`, ephemeral: true }
  }
  if (!visible.length) {
    return {
      content:
        'No servers are shared here yet. Turn on a server’s public page in Flytower to show it.',
      ephemeral: true,
    }
  }
  return visible.slice(0, 10)
}

function serverCommand(
  source: ServerSource,
  def: Pick<DiscordCommand, 'name' | 'description'>,
  answer: (statuses: PublicStatus[]) => Reply,
  deadlineMs: number,
): DiscordCommand {
  return {
    ...def,
    permission: 'public',
    options: [SERVER_OPTION],
    autocomplete: (ctx, focused) =>
      focused.name === 'server'
        ? serverChoices(visibleServers(source, ctx.access), focused.value)
        : [],
    handle(ctx) {
      const picked = pick(source, ctx)
      if (!Array.isArray(picked)) return picked
      return inTime(Promise.all(picked.map((s) => source.status(s.name))).then(answer), deadlineMs)
    },
  }
}

export function statusCommand(source: ServerSource, deadlineMs = DEADLINE_MS): DiscordCommand {
  return serverCommand(
    source,
    {
      name: 'status',
      description: 'Whether a Minecraft server is up, its address and how many are on.',
    },
    (statuses) => ({ embeds: statuses.map((s) => statusEmbed(s, source.origin())) }),
    deadlineMs,
  )
}

export function playersCommand(source: ServerSource, deadlineMs = DEADLINE_MS): DiscordCommand {
  return serverCommand(
    source,
    { name: 'players', description: 'Who is on a Minecraft server right now.' },
    (statuses) => ({ content: statuses.map(playersText).join('\n') }),
    deadlineMs,
  )
}
