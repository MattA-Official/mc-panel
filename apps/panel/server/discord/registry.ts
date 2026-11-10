/**
 * Flytower's slash commands. Each command says what it needs (a permission, or nothing for
 * public ones) and how to answer; the registry turns them into Discord's command list and
 * routes interactions to them. Built-in commands are added at start; plugins will add theirs
 * through the same `add()`.
 */
import {
  canAnywhere,
  isServerPermission,
  can,
  type Access,
  type Permission,
} from '../../shared/permissions'
import {
  EPHEMERAL,
  InteractionType,
  ResponseType,
  ephemeral,
  type Interaction,
} from './interactions'

/** Discord's option types that Flytower uses. */
export const OptionType = { SubCommand: 1, String: 3, Integer: 4, Boolean: 5 } as const

export interface CommandOption {
  type: (typeof OptionType)[keyof typeof OptionType]
  name: string
  description: string
  required?: boolean
  /** Ask the command for choices as the person types. */
  autocomplete?: boolean
  /** The only values allowed, shown as a list. */
  choices?: Choice[]
  /** Up to this many characters, for strings. */
  maxLength?: number
  /** A sub-command's own options. */
  options?: CommandOption[]
}

export type OptionValue = string | number | boolean

export interface CommandContext {
  interaction: Interaction
  /** The sub-command used, as in `/whitelist add`, or null. */
  subcommand: string | null
  /** The options given, by name (a sub-command's own options when there is one). */
  options: Record<string, OptionValue>
  /** What the caller may do in Flytower, from their mapped Discord roles. */
  access: Access
  /** The caller's Discord user and, in a server, their role IDs. */
  discordUserId: string | null
  discordRoleIds: string[]
  /**
   * Turns the caller away when the command's own check (say, the server they picked) fails:
   * reports the refusal like one from the registry and gives the polite answer.
   */
  refuse(): Reply
}

export interface Reply {
  content?: string
  embeds?: unknown[]
  /** Only the caller sees it. */
  ephemeral?: boolean
  /**
   * Work that finishes later, like a restart. The reply goes out at once; this one follows
   * up in the channel when the work is done (Discord allows 15 minutes).
   */
  followUp?: () => Promise<Reply>
}

export interface Choice {
  name: string
  value: string
}

export interface DiscordCommand {
  /** 1 to 32 lower-case letters, digits, - or _. */
  name: string
  description: string
  options?: CommandOption[]
  /** What the caller needs, or 'public' for anyone in the Discord server. */
  permission: Permission | 'public'
  handle(ctx: CommandContext): Promise<Reply> | Reply
  /** Choices for the option being typed (`focused`). */
  autocomplete?(
    ctx: CommandContext,
    focused: { name: string; value: string },
  ): Promise<Choice[]> | Choice[]
}

const NAME = /^[-_a-z0-9]{1,32}$/

export class CommandRegistry {
  private commands = new Map<string, DiscordCommand>()

  add(command: DiscordCommand): this {
    if (!NAME.test(command.name)) throw new Error(`Bad command name: ${command.name}`)
    if (this.commands.has(command.name)) throw new Error(`/${command.name} is already registered`)
    if (!command.description || command.description.length > 100) {
      throw new Error(`/${command.name} needs a description of up to 100 characters`)
    }
    const check = (options: CommandOption[]) => {
      for (const o of options) {
        if (!NAME.test(o.name)) throw new Error(`Bad option name on /${command.name}: ${o.name}`)
        check(o.options ?? [])
      }
    }
    check(command.options ?? [])
    this.commands.set(command.name, command)
    return this
  }

  get(name: string): DiscordCommand | undefined {
    return this.commands.get(name)
  }

  names(): string[] {
    return [...this.commands.keys()].sort()
  }

  /** The command list in Discord's shape, for a bulk overwrite. Sorted, so its hash is stable. */
  definitions() {
    return this.names().map((name) => {
      const c = this.commands.get(name)!
      return {
        name: c.name,
        type: 1,
        description: c.description,
        options: (c.options ?? []).map(optionDefinition),
        // Usable in servers and DMs with the app; the app can't do anything private yet.
        contexts: [0, 1],
        integration_types: [0],
      }
    })
  }

  /** Changes whenever the command list Discord should have changes. */
  hash(): string {
    return new Bun.CryptoHasher('sha256').update(JSON.stringify(this.definitions())).digest('hex')
  }
}

function optionDefinition(o: CommandOption): Record<string, unknown> {
  return {
    type: o.type,
    name: o.name,
    description: o.description,
    // Discord refuses `required` on a sub-command.
    ...(o.type !== OptionType.SubCommand && { required: o.required ?? false }),
    ...(o.autocomplete && { autocomplete: true }),
    ...(o.choices && { choices: o.choices }),
    ...(o.maxLength && { max_length: o.maxLength }),
    ...(o.options && { options: o.options.map(optionDefinition) }),
  }
}

/** Whether `access` allows what a command needs. Server permissions count on any server. */
export function allowed(access: Access, permission: DiscordCommand['permission']): boolean {
  if (permission === 'public') return true
  return isServerPermission(permission) ? canAnywhere(access, permission) : can(access, permission)
}

interface DataOption {
  name: string
  type: number
  value?: OptionValue
  focused?: boolean
  options?: DataOption[]
}
interface CommandData {
  name?: string
  options?: DataOption[]
}

/** A reply as a message body, with mentions always off. */
export function toMessage(reply: Reply) {
  return {
    ...(reply.content !== undefined && { content: reply.content.slice(0, 2000) }),
    ...(reply.embeds && { embeds: reply.embeds.slice(0, 10) }),
    ...(reply.ephemeral && { flags: EPHEMERAL }),
    allowed_mentions: { parse: [] },
  }
}

/** Turns a reply into Discord's response, with mentions always off. */
export function toResponse(reply: Reply) {
  return { type: ResponseType.ChannelMessage, data: toMessage(reply) }
}

export interface RouteHooks {
  /** Someone used a command they don't have access to. */
  refused?(ctx: CommandContext, command: DiscordCommand): void
  /** A reply's follow-up is done: post it to the interaction. */
  followUp?(interaction: Interaction, reply: Reply): Promise<void>
}

export const REFUSAL =
  'Sorry, you can’t use that. Ask whoever runs the Minecraft server to give your Discord role access in Flytower.'

/** Answers one verified interaction through the registry. */
export async function route(
  registry: CommandRegistry,
  interaction: Interaction,
  accessFor: (interaction: Interaction) => Access,
  hooks: RouteHooks = {},
): Promise<unknown> {
  if (interaction.type === InteractionType.Ping) return { type: ResponseType.Pong }
  const data = (interaction.data ?? {}) as CommandData
  const command = data.name ? registry.get(data.name) : undefined
  const isAutocomplete = interaction.type === InteractionType.Autocomplete
  if (interaction.type !== InteractionType.ApplicationCommand && !isAutocomplete) {
    return ephemeral('Flytower can’t answer that yet.')
  }
  if (!command) {
    return isAutocomplete
      ? { type: ResponseType.AutocompleteResult, data: { choices: [] } }
      : ephemeral('That command isn’t available any more.')
  }
  const options: Record<string, OptionValue> = {}
  let focused: { name: string; value: string } | null = null
  const sub = data.options?.[0]?.type === OptionType.SubCommand ? data.options[0] : null
  for (const o of (sub ? sub.options : data.options) ?? []) {
    if (o.value === undefined) continue
    options[o.name] = o.value
    if (o.focused) focused = { name: o.name, value: String(o.value) }
  }
  const ctx: CommandContext = {
    interaction,
    subcommand: sub?.name ?? null,
    options,
    access: accessFor(interaction),
    discordUserId: interaction.member?.user?.id ?? interaction.user?.id ?? null,
    discordRoleIds: interaction.member?.roles ?? [],
    refuse() {
      try {
        hooks.refused?.(ctx, command)
      } catch (err) {
        console.error('[flytower] recording a refused Discord command failed', err)
      }
      return { content: REFUSAL, ephemeral: true }
    },
  }
  if (isAutocomplete) {
    const choices =
      command.autocomplete && focused && allowed(ctx.access, command.permission)
        ? await command.autocomplete(ctx, focused)
        : []
    return { type: ResponseType.AutocompleteResult, data: { choices: choices.slice(0, 25) } }
  }
  if (!allowed(ctx.access, command.permission)) return toResponse(ctx.refuse())
  try {
    const reply = await command.handle(ctx)
    if (reply.followUp) {
      const later = reply.followUp
      // After this response has gone back, so the follow-up can't arrive first.
      setTimeout(() => {
        later()
          .catch((err) => {
            console.error(`[flytower] Discord /${command.name} follow-up failed`, err)
            return { content: 'Something went wrong finishing that. Check Flytower.' }
          })
          .then((r) => hooks.followUp?.(interaction, r))
          .catch((err) => console.error('[flytower] posting a Discord follow-up failed', err))
      }, 0)
    }
    return toResponse(reply)
  } catch (err) {
    console.error(`[flytower] Discord /${command.name} failed`, err)
    return ephemeral('Something went wrong answering that. Try again in a moment.')
  }
}
