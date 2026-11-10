import { describe, expect, it } from 'bun:test'
import { CommandRegistry, route } from '../server/discord/registry'
import { discordAccess, discordActor, viaDiscord } from '../server/discord/roles'
import { InteractionType, EPHEMERAL, type Interaction } from '../server/discord/interactions'
import { BUILT_IN_ROLES, can, canAnywhere, NO_ACCESS, type Permission } from '../shared/permissions'
import { auditActor, describeAudit } from '../shared/utils/audit'
import type { DiscordRoleMapping } from '../shared/discord'

const roles: Record<string, readonly Permission[]> = {
  operator: BUILT_IN_ROLES.operator.permissions,
  viewer: BUILT_IN_ROLES.viewer.permissions,
  greeter: ['server.view', 'console.command'],
}
const lookup = (id: string) => roles[id] ?? null

const mappings: DiscordRoleMapping[] = [
  { discordRoleId: '1001', label: 'Staff', roleId: 'operator', server: null },
  { discordRoleId: '1002', label: 'Builders', roleId: 'greeter', server: 'creative' },
  { discordRoleId: '1003', label: 'Old', roleId: 'deleted-role', server: null },
]

const interaction = (
  memberRoles: string[] | null,
  over: Partial<Interaction> = {},
): Interaction => ({
  id: '1',
  type: InteractionType.ApplicationCommand,
  application_id: '123',
  token: 't',
  guild_id: '9',
  ...(memberRoles && {
    member: {
      user: { id: '42', username: 'steve', global_name: 'Steve' },
      nick: null,
      roles: memberRoles,
    },
  }),
  data: { name: 'restart', options: [{ name: 'server', type: 3, value: 'creative' }] },
  ...over,
})

describe('Discord role mapping', () => {
  it('gives a mapped role its Flytower role on all servers', () => {
    const access = discordAccess(mappings, interaction(['1001', '555']), lookup)
    expect(can(access, 'server.power', 'survival')).toBe(true)
    expect(can(access, 'backups.create', 'creative')).toBe(true)
    expect(can(access, 'backups.restore', 'creative')).toBe(false)
  })

  it('keeps a per-server mapping to its server', () => {
    const access = discordAccess(mappings, interaction(['1002']), lookup)
    expect(can(access, 'console.command', 'creative')).toBe(true)
    expect(can(access, 'console.command', 'survival')).toBe(false)
    expect(canAnywhere(access, 'console.command')).toBe(true)
  })

  it('folds several mapped roles together', () => {
    const access = discordAccess(mappings, interaction(['1001', '1002']), lookup)
    expect(can(access, 'console.command', 'survival')).toBe(true)
    expect(access.servers.creative).toContain('console.command')
  })

  it('gives nothing to unmapped members, DMs, or roles mapped to a deleted Flytower role', () => {
    expect(discordAccess(mappings, interaction(['555']), lookup)).toEqual(NO_ACCESS)
    expect(discordAccess(mappings, interaction(['1003']), lookup)).toEqual(NO_ACCESS)
    // A DM carries `user`, not `member`: no roles to go on.
    const dm = interaction(null, { guild_id: undefined, user: { id: '42' } })
    expect(discordAccess(mappings, dm, lookup)).toEqual(NO_ACCESS)
    // Role IDs from a DM-shaped payload without a guild are ignored too.
    expect(discordAccess(mappings, interaction(['1001'], { guild_id: undefined }), lookup)).toEqual(
      NO_ACCESS,
    )
  })

  it('names the caller by nickname, display name, then username', () => {
    expect(discordActor(interaction(['1']))).toEqual({ id: '42', name: 'Steve' })
    const nick = interaction(['1'])
    nick.member!.nick = 'Stevie'
    expect(discordActor(nick)?.name).toBe('Stevie')
    expect(discordActor(interaction(null, { user: { id: '7', username: 'alex' } }))?.name).toBe(
      'alex',
    )
  })
})

describe('refusing a command', () => {
  const registry = () =>
    new CommandRegistry().add({
      name: 'restart',
      description: 'Restart',
      permission: 'server.power',
      handle: () => ({ content: 'Restarting' }),
    })

  it('refuses politely, only to the caller, and reports the refusal', async () => {
    const refused: string[] = []
    const i = interaction(['555'])
    const res = (await route(registry(), i, (x) => discordAccess(mappings, x, lookup), {
      refused: (ctx, c) => refused.push(`${c.name}:${ctx.options.server}`),
    })) as { data: { content: string; flags: number } }
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toContain('Sorry, you can’t use that')
    expect(refused).toEqual(['restart:creative'])
  })

  it('runs the command for a mapped member and reports nothing', async () => {
    const refused: string[] = []
    const res = (await route(
      registry(),
      interaction(['1001']),
      (x) => discordAccess(mappings, x, lookup),
      {
        refused: (_, c) => refused.push(c.name),
      },
    )) as { data: { content: string } }
    expect(res.data.content).toBe('Restarting')
    expect(refused).toEqual([])
  })

  it('still answers when recording the refusal fails', async () => {
    const res = (await route(registry(), interaction(['555']), () => NO_ACCESS, {
      refused: () => {
        throw new Error('db gone')
      },
    })) as { data: { content: string } }
    expect(res.data.content).toContain('Sorry')
  })
})

describe('Discord in Activity', () => {
  const detail = viaDiscord({ id: '42', name: 'Steve' }, { command: 'restart' })

  it('shows Discord actions as "Name via Discord"', () => {
    expect(auditActor('server.restart', null, detail)).toBe('Steve via Discord')
    expect(auditActor('server.restart', null, { via: 'discord' })).toBe('Someone via Discord')
    expect(auditActor('server.restart', 'Matt', detail)).toBe('Matt')
  })

  it('describes refusals and mapping changes', () => {
    expect(describeAudit('discord.refused', 'creative', detail)).toBe(
      'Tried /restart on creative without access',
    )
    expect(
      describeAudit('discord.roles', null, { mappings: ['Staff gets Operator on all servers'] }),
    ).toBe('Changed which Discord roles get Flytower roles (Staff gets Operator on all servers)')
    expect(describeAudit('discord.roles', null, { mappings: [] })).toBe(
      'Took away access from all Discord roles',
    )
  })
})
