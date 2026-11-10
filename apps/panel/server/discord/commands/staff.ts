/**
 * Staff commands: /whitelist, /restart, /backup and /say. Each needs a Flytower permission on
 * the server picked, which the caller gets through a mapped Discord role. Everything they do
 * goes in Activity as "Name via Discord", the same entries the panel makes.
 */
import { PLAYER_NAME } from '@flytower/providers'
import { can, type ServerPermission } from '../../../shared/permissions'
import { escapeMarkdown } from '../../notify/discord'
import {
  OptionType,
  type CommandContext,
  type CommandOption,
  type DiscordCommand,
  type Reply,
} from '../registry'
import { discordActor, viaDiscord } from '../roles'
import { serverChoices, type ServerEntry } from './servers'

export interface StaffDeps {
  servers(): ServerEntry[]
  running(name: string): Promise<boolean>
  /** Adds or takes a player off the whitelist; returns what happened, throws to refuse. */
  whitelist(name: string, action: 'add' | 'remove', player: string): Promise<string>
  /** Restarts; resolves once it's back (true) or it hasn't said it's ready in time (false). */
  restart(name: string): Promise<boolean>
  /** Starts a backup; throws at once if the server is busy. */
  backup(name: string, note: string | null): { done: Promise<{ ok: boolean; message: string }> }
  /** Sends a raw console command (only `tellraw` from here). */
  command(name: string, command: string): Promise<string>
  audit(action: string, target: string, detail: Record<string, unknown>): void
}

/** The text of an error, as the panel would show it (HTTP errors carry `statusMessage`). */
export function errorText(err: unknown): string {
  const e = err as { statusMessage?: string; message?: string }
  return (e.statusMessage || e.message || 'Something went wrong.').slice(0, 300)
}

const bold = (s: string) => `**${escapeMarkdown(s)}**`

/** Servers the caller may do `permission` on. */
export function actableServers(
  deps: StaffDeps,
  ctx: CommandContext,
  permission: ServerPermission,
): ServerEntry[] {
  return deps
    .servers()
    .filter((s) => can(ctx.access, permission, s.name))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/**
 * The server to act on: the one asked for, or the only one the caller can act on. A server
 * they can see but not act on is a refusal; one they can't see answers like one that doesn't
 * exist.
 */
export function pickServer(
  deps: StaffDeps,
  ctx: CommandContext,
  permission: ServerPermission,
): ServerEntry | Reply {
  const actable = actableServers(deps, ctx, permission)
  const asked = ctx.options.server
  if (typeof asked === 'string' && asked.trim()) {
    const q = asked.trim().toLowerCase()
    const match = (s: ServerEntry) => s.name === q || s.displayName.toLowerCase() === q
    const found = actable.find(match)
    if (found) return found
    const seen = deps
      .servers()
      .find((s) => match(s) && (s.public || can(ctx.access, 'server.view', s.name)))
    if (seen) return ctx.refuse()
    return { content: `There's no server called “${asked.slice(0, 40)}”.`, ephemeral: true }
  }
  if (actable.length === 1) return actable[0]!
  if (!actable.length) return ctx.refuse()
  return {
    content: `Which server? Pick one with the \`server\` option: ${actable.map((s) => escapeMarkdown(s.displayName)).join(', ')}.`,
    ephemeral: true,
  }
}

const isReply = (v: ServerEntry | Reply): v is Reply => !('name' in v && 'displayName' in v)

const serverOption = (description: string): CommandOption => ({
  type: OptionType.String,
  name: 'server',
  description,
  autocomplete: true,
})

function staffCommand(
  deps: StaffDeps,
  def: Omit<DiscordCommand, 'permission' | 'handle' | 'autocomplete'> & {
    permission: ServerPermission
    handle(ctx: CommandContext, server: ServerEntry): Promise<Reply> | Reply
  },
): DiscordCommand {
  return {
    ...def,
    autocomplete: (ctx, focused) =>
      focused.name === 'server'
        ? serverChoices(actableServers(deps, ctx, def.permission), focused.value)
        : [],
    handle(ctx) {
      const server = pickServer(deps, ctx, def.permission)
      return isReply(server) ? server : def.handle(ctx, server)
    },
  }
}

const audited = (ctx: CommandContext, extra: Record<string, unknown> = {}) =>
  viaDiscord(discordActor(ctx.interaction), extra)

export function whitelistCommand(deps: StaffDeps): DiscordCommand {
  const options = (verb: string): CommandOption[] => [
    {
      type: OptionType.String,
      name: 'player',
      description: `The Minecraft username to ${verb}.`,
      required: true,
      maxLength: 16,
    },
    serverOption('Which server. Leave it out if you only look after one.'),
  ]
  return staffCommand(deps, {
    name: 'whitelist',
    description: 'Add someone to a Minecraft server’s whitelist, or take them off.',
    permission: 'players.manage',
    options: [
      {
        type: OptionType.SubCommand,
        name: 'add',
        description: 'Let a player join.',
        options: options('add'),
      },
      {
        type: OptionType.SubCommand,
        name: 'remove',
        description: 'Take a player off the whitelist.',
        options: options('take off'),
      },
    ],
    async handle(ctx, server) {
      const action = ctx.subcommand === 'remove' ? 'remove' : 'add'
      const player = String(ctx.options.player ?? '').trim()
      if (!PLAYER_NAME.test(player)) {
        return { content: 'That isn’t a valid Minecraft username.', ephemeral: true }
      }
      try {
        await deps.whitelist(server.name, action, player)
      } catch (err) {
        return { content: `Couldn’t do that: ${errorText(err)}`, ephemeral: true }
      }
      deps.audit(`players.whitelist-${action}`, server.name, audited(ctx, { player }))
      return {
        content:
          action === 'add'
            ? `Whitelisted ${bold(player)} on ${bold(server.displayName)}.`
            : `Took ${bold(player)} off the whitelist on ${bold(server.displayName)}.`,
      }
    },
  })
}

export function restartCommand(deps: StaffDeps): DiscordCommand {
  return staffCommand(deps, {
    name: 'restart',
    description: 'Restart a Minecraft server. Players are disconnected for a minute or so.',
    permission: 'server.power',
    options: [serverOption('Which server. Leave it out if you only look after one.')],
    handle(ctx, server) {
      deps.audit('server.restart', server.name, audited(ctx))
      const name = bold(server.displayName)
      return {
        content: `Restarting ${name}. It'll be back in a minute or so.`,
        followUp: () =>
          deps.restart(server.name).then(
            (ready) => ({
              content: ready
                ? `${name} is back up.`
                : `${name} restarted but hasn't said it's ready yet. Check Flytower.`,
            }),
            (err) => ({ content: `Couldn’t restart ${name}: ${errorText(err)}` }),
          ),
      }
    },
  })
}

export function backupCommand(deps: StaffDeps): DiscordCommand {
  return staffCommand(deps, {
    name: 'backup',
    description: 'Back up a Minecraft server now.',
    permission: 'backups.create',
    options: [
      serverOption('Which server. Leave it out if you only look after one.'),
      {
        type: OptionType.String,
        name: 'note',
        description: 'A note to find the backup by, like “before the update”.',
        maxLength: 200,
      },
    ],
    handle(ctx, server) {
      const note = typeof ctx.options.note === 'string' ? ctx.options.note.trim() || null : null
      let started: ReturnType<StaffDeps['backup']>
      try {
        started = deps.backup(server.name, note)
      } catch (err) {
        return { content: `Couldn’t back up: ${errorText(err)}`, ephemeral: true }
      }
      deps.audit('backup.create', server.name, audited(ctx, { note }))
      const name = bold(server.displayName)
      return {
        content: `Backing up ${name}.`,
        followUp: () =>
          started.done.then((r) => ({
            content: r.ok
              ? `Backed up ${name}. ${r.message}`
              : `The backup of ${name} failed: ${r.message}`,
          })),
      }
    },
  })
}

/** Strips anything that isn't plain, printable text, and caps the length. */
export function cleanMessage(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/§/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256)
}

/**
 * The `tellraw` that shows a message from Discord. It's JSON text built with JSON.stringify,
 * so nothing in the message can close the string, add click events or run a command.
 */
export function tellraw(from: string, message: string): string {
  const text = [
    '',
    { text: '[Discord] ', color: 'blue' },
    { text: `${cleanMessage(from).slice(0, 40)}: `, color: 'gray' },
    { text: message },
  ]
  return `tellraw @a ${JSON.stringify(text)}`
}

export function sayCommand(deps: StaffDeps): DiscordCommand {
  return staffCommand(deps, {
    name: 'say',
    description: 'Send a message to everyone on a Minecraft server.',
    permission: 'console.command',
    options: [
      {
        type: OptionType.String,
        name: 'message',
        description: 'What to say. Shown in the game as [Discord] your name: message.',
        required: true,
        maxLength: 256,
      },
      serverOption('Which server. Leave it out if you only look after one.'),
    ],
    async handle(ctx, server) {
      const message = cleanMessage(String(ctx.options.message ?? ''))
      if (!message) return { content: 'There’s nothing to say.', ephemeral: true }
      if (!(await deps.running(server.name))) {
        return { content: `${bold(server.displayName)} isn’t running.`, ephemeral: true }
      }
      const actor = discordActor(ctx.interaction)
      try {
        await deps.command(server.name, tellraw(actor?.name ?? 'Discord', message))
      } catch (err) {
        return { content: `Couldn’t send that: ${errorText(err)}`, ephemeral: true }
      }
      deps.audit('server.say', server.name, audited(ctx, { message }))
      return { content: `Said on ${bold(server.displayName)}: ${escapeMarkdown(message)}` }
    },
  })
}

export const staffCommands = (deps: StaffDeps) => [
  whitelistCommand(deps),
  restartCommand(deps),
  backupCommand(deps),
  sayCommand(deps),
]
