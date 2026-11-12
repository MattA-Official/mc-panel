/**
 * Discord roles to Flytower roles. Every interaction from a Discord server carries the
 * member's role IDs, so a mapping is all it takes to know what they may do: no account
 * linking. Role IDs are unique across Discord, so a mapping only ever matches members of the
 * one Discord server the role belongs to.
 */
import { foldGrants, NO_ACCESS, type Access, type Permission } from '../../shared/permissions'
import type { DiscordRoleMapping } from '../../shared/discord'
import type { Interaction } from './interactions'

export const SNOWFLAKE = /^\d{5,25}$/

/** At most this many mappings; more would be a sign something's wrong. */
export const MAX_MAPPINGS = 50

/**
 * What a Discord member may do: the Flytower roles mapped to their Discord roles, folded the
 * same way as a person's grants. Outside a Discord server (a DM with the app), nothing.
 * `rolePermissions` returns null for a Flytower role that no longer exists.
 */
export function discordAccess(
  mappings: readonly DiscordRoleMapping[],
  interaction: Pick<Interaction, 'guild_id' | 'member'>,
  rolePermissions: (roleId: string) => readonly Permission[] | null,
): Access {
  if (!interaction.guild_id || !interaction.member) return NO_ACCESS
  const held = new Set(interaction.member.roles ?? [])
  const grants = []
  for (const m of mappings) {
    if (!held.has(m.discordRoleId)) continue
    const permissions = rolePermissions(m.roleId)
    if (permissions) grants.push({ permissions, server: m.server })
  }
  return grants.length ? foldGrants(grants) : NO_ACCESS
}

/** Who used a command, as Activity shows them. */
export interface DiscordActor {
  /** The Discord user ID. */
  id: string
  /** Their nickname in the Discord server, display name or username, in that order. */
  name: string
}

export function discordActor(interaction: Interaction): DiscordActor | null {
  const user = interaction.member?.user ?? interaction.user
  if (!user) return null
  const name = interaction.member?.nick || user.global_name || user.username || user.id
  return { id: user.id, name: name.slice(0, 80) }
}

/** The audit detail that marks an entry as done from Discord. */
export function viaDiscord(actor: DiscordActor | null, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    via: 'discord',
    discordUser: actor?.id ?? null,
    discordName: actor?.name ?? null,
  }
}
