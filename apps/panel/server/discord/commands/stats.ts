/**
 * /leaderboard and /stats: the same figures as the Stats tab and the public page, with the
 * same rules. People who can see a server in Flytower get what the Stats tab shows; anyone
 * else only sees servers whose public page shows leaderboards, and nothing about visits.
 * Left-out players never appear, and a server that keeps no stats shows nothing publicly.
 */
import type { Access } from '../../../shared/permissions'
import {
  BOARDS,
  PERIOD_LABELS,
  PERIODS,
  findBoard,
  formatStat,
  type Board,
  type BoardKey,
  type Period,
} from '../../../shared/leaderboards'
import { COLOURS, escapeMarkdown } from '../../notify/discord'
import {
  OptionType,
  type Choice,
  type CommandContext,
  type DiscordCommand,
  type Reply,
} from '../registry'
import { DEADLINE_MS, serverChoices, type ServerEntry } from './servers'

/** A player's figures for /stats. Visits only for callers who can see the server. */
export interface PlayerStats {
  name: string
  uuid: string
  allTime: Record<BoardKey, number>
  week: Record<BoardKey, number>
  lastSeen?: number | null
  sessions?: number
}

export interface StatsSource {
  /** Servers whose stats this caller may see, by display name. */
  servers(access: Access): ServerEntry[]
  /** The boards for a period, or null when this caller may not see them. */
  boards(
    server: string,
    period: Period,
    access: Access,
  ): Promise<{ boards: Board[]; since: string | null } | null>
  /** One player's figures by name (any case), or null when there's no such player to show. */
  player(server: string, name: string, access: Access): Promise<PlayerStats | null>
  /** Names to offer while typing a player. */
  playerNames(server: string, access: Access): Promise<string[]>
}

const SERVER_OPTION = {
  type: OptionType.String,
  name: 'server',
  description: 'Which server. Leave it out when there is only one.',
  autocomplete: true,
} as const

/** The server asked for, or the only one; a private message otherwise. */
function pickServer(source: StatsSource, ctx: CommandContext): ServerEntry | Reply {
  const visible = source.servers(ctx.access)
  const asked = ctx.options.server
  if (typeof asked === 'string' && asked) {
    const q = asked.trim().toLowerCase()
    const found = visible.find((s) => s.name === q || s.displayName.toLowerCase() === q)
    // A server the caller can't see answers the same as one that doesn't exist.
    return (
      found ?? {
        content: `There are no stats for a server called “${asked.slice(0, 40)}”.`,
        ephemeral: true,
      }
    )
  }
  if (visible.length === 1) return visible[0]!
  if (!visible.length) {
    return {
      content:
        'No leaderboards are shared here yet. Turn on leaderboards on a server’s public page in Flytower to show them.',
      ephemeral: true,
    }
  }
  return {
    content: `Pick a server: ${visible.map((s) => s.displayName).join(', ')}.`.slice(0, 2000),
    ephemeral: true,
  }
}

function periodNote(period: Period, since: string | null): string {
  if (!since) return PERIOD_LABELS[period]
  const d = new Date(`${since}T12:00:00Z`)
  return `${PERIOD_LABELS[period]}, since ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
}

export function leaderboardEmbed(
  server: ServerEntry,
  board: Board,
  period: Period,
  since: string | null,
) {
  const lines = board.entries.map(
    (e) => `**${e.rank}.** ${escapeMarkdown(e.name)} · ${formatStat(board.unit, e.value)}`,
  )
  return {
    title: `${server.displayName} · ${board.label}`.slice(0, 256),
    color: COLOURS.info,
    description: lines.length ? lines.join('\n') : 'Nobody yet.',
    footer: { text: `${periodNote(period, since)}. Updated once a day.` },
  }
}

export function playerEmbed(server: ServerEntry, p: PlayerStats) {
  const fields = BOARDS.map((b) => {
    const week = p.week[b.key]
    return {
      name: b.label,
      value: `${formatStat(b.unit, p.allTime[b.key])}${week ? `\n+${formatStat(b.unit, week)} this week` : ''}`,
      inline: true,
    }
  })
  const visits =
    p.sessions !== undefined && p.lastSeen
      ? `${p.sessions} visit${p.sessions === 1 ? '' : 's'}, last seen <t:${Math.floor(p.lastSeen / 1000)}:R>`
      : null
  return {
    title: `${escapeMarkdown(p.name)} on ${server.displayName}`.slice(0, 256),
    color: COLOURS.info,
    ...(visits && { description: visits }),
    fields,
    footer: { text: 'All time. Updated once a day.' },
  }
}

/** Runs `work`, or answers privately that it's still working if it takes too long. */
async function inTime(work: Promise<Reply>, ms: number): Promise<Reply> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Reply>((resolve) => {
    timer = setTimeout(
      () => resolve({ content: 'Still adding up. Try again in a moment.', ephemeral: true }),
      ms,
    )
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

const serverAutocomplete =
  (source: StatsSource) => (ctx: CommandContext, focused: { name: string; value: string }) =>
    focused.name === 'server' ? serverChoices(source.servers(ctx.access), focused.value) : []

export function leaderboardCommand(source: StatsSource, deadlineMs = DEADLINE_MS): DiscordCommand {
  return {
    name: 'leaderboard',
    description: 'The top players on a Minecraft server: playtime, deaths, kills and more.',
    permission: 'public',
    options: [
      {
        type: OptionType.String,
        name: 'stat',
        description: 'Which leaderboard. Playtime unless you pick another.',
        choices: BOARDS.map((b) => ({ name: b.label, value: b.key })),
      },
      {
        type: OptionType.String,
        name: 'period',
        description: 'All time unless you pick another.',
        choices: PERIODS.map((p) => ({ name: PERIOD_LABELS[p], value: p })),
      },
      SERVER_OPTION,
    ],
    autocomplete: serverAutocomplete(source),
    handle(ctx) {
      const server = pickServer(source, ctx)
      if (!('name' in server)) return server
      const board = findBoard(String(ctx.options.stat ?? 'playtime')) ?? BOARDS[0]
      const asked = String(ctx.options.period ?? 'all')
      const period: Period = (PERIODS as readonly string[]).includes(asked)
        ? (asked as Period)
        : 'all'
      return inTime(
        source.boards(server.name, period, ctx.access).then((r): Reply => {
          const b = r?.boards.find((x) => x.key === board.key)
          if (!r || !b) {
            return {
              content: `There are no stats for a server called “${server.displayName}”.`,
              ephemeral: true,
            }
          }
          return { embeds: [leaderboardEmbed(server, b, period, r.since)] }
        }),
        deadlineMs,
      )
    },
  }
}

export function statsCommand(source: StatsSource, deadlineMs = DEADLINE_MS): DiscordCommand {
  return {
    name: 'stats',
    description: 'One player’s stats on a Minecraft server.',
    permission: 'public',
    options: [
      {
        type: OptionType.String,
        name: 'player',
        description: 'Their Minecraft name.',
        required: true,
        autocomplete: true,
      },
      SERVER_OPTION,
    ],
    async autocomplete(ctx, focused): Promise<Choice[]> {
      if (focused.name === 'server') return serverAutocomplete(source)(ctx, focused)
      if (focused.name !== 'player') return []
      const server = pickServer(source, ctx)
      if (!('name' in server)) return []
      const q = focused.value.trim().toLowerCase()
      return (await source.playerNames(server.name, ctx.access))
        .filter((n) => !q || n.toLowerCase().includes(q))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25)
        .map((n) => ({ name: n, value: n }))
    },
    handle(ctx) {
      const server = pickServer(source, ctx)
      if (!('name' in server)) return server
      const name = String(ctx.options.player ?? '').trim()
      return inTime(
        source.player(server.name, name, ctx.access).then((p): Reply =>
          p
            ? { embeds: [playerEmbed(server, p)] }
            : {
                content: `No stats for “${escapeMarkdown(name.slice(0, 32))}” on ${server.displayName}.`,
                ephemeral: true,
              },
        ),
        deadlineMs,
      )
    },
  }
}
