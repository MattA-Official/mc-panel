import { describe, expect, it } from 'bun:test'
import { CommandRegistry, OptionType, route, type Reply } from '../server/discord/registry'
import { discordAccess } from '../server/discord/roles'
import {
  cleanMessage,
  staffCommands,
  tellraw,
  type StaffDeps,
} from '../server/discord/commands/staff'
import {
  InteractionType,
  ResponseType,
  EPHEMERAL,
  type Interaction,
} from '../server/discord/interactions'
import { BUILT_IN_ROLES, type Permission } from '../shared/permissions'
import { auditActor, describeAudit } from '../shared/utils/audit'
import type { DiscordRoleMapping } from '../shared/discord'

const roles: Record<string, readonly Permission[]> = {
  operator: BUILT_IN_ROLES.operator.permissions,
  viewer: BUILT_IN_ROLES.viewer.permissions,
}
const mappings: DiscordRoleMapping[] = [
  { discordRoleId: '100', label: 'Staff', roleId: 'operator', server: null },
  { discordRoleId: '200', label: 'Creative mods', roleId: 'operator', server: 'creative' },
  { discordRoleId: '300', label: 'Members', roleId: 'viewer', server: null },
]

function fakeDeps(over: Partial<StaffDeps> = {}) {
  const log: { action: string; target: string; detail: Record<string, unknown> }[] = []
  const calls: string[] = []
  const deps: StaffDeps = {
    servers: () => [
      { name: 'survival', displayName: 'Survival SMP', public: true },
      { name: 'creative', displayName: 'Creative', public: false },
      { name: 'secret', displayName: 'Secret', public: false },
    ],
    running: async () => true,
    async whitelist(name, action, player) {
      calls.push(`whitelist ${action} ${player} on ${name}`)
      return 'ok'
    },
    async restart(name) {
      calls.push(`restart ${name}`)
      return true
    },
    backup(name, note) {
      calls.push(`backup ${name} ${note}`)
      return { done: Promise.resolve({ ok: true, message: 'Backed up 12 MB.' }) }
    },
    async command(name, command) {
      calls.push(`${name}: ${command}`)
      return ''
    },
    audit: (action, target, detail) => log.push({ action, target, detail }),
    ...over,
  }
  return { deps, log, calls }
}

type Opt = { name: string; type: number; value?: string; options?: Opt[] }
const interaction = (name: string, memberRoles: string[], options: Opt[] = []): Interaction => ({
  id: '1',
  type: InteractionType.ApplicationCommand,
  application_id: '123',
  token: 'tok',
  guild_id: '9',
  member: { user: { id: '42', username: 'steve', global_name: 'Steve' }, roles: memberRoles },
  data: { name, options },
})
const str = (name: string, value: string): Opt => ({ name, type: OptionType.String, value })

async function run(
  i: Interaction,
  deps: StaffDeps,
  hooks: { refused?: string[]; followUps?: Reply[] } = {},
) {
  const registry = new CommandRegistry()
  for (const c of staffCommands(deps)) registry.add(c)
  const res = (await route(
    registry,
    i,
    (x) => discordAccess(mappings, x, (id) => roles[id] ?? null),
    {
      refused: (_, c) => hooks.refused?.push(c.name),
      followUp: async (_, r) => void hooks.followUps?.push(r),
    },
  )) as { type: number; data: { content: string; flags?: number; allowed_mentions: unknown } }
  return res
}

describe('staff command definitions', () => {
  it('gives /whitelist add and remove sub-commands for Discord', () => {
    const r = new CommandRegistry()
    for (const c of staffCommands(fakeDeps().deps)) r.add(c)
    expect(r.names()).toEqual(['backup', 'restart', 'say', 'whitelist'])
    const wl = r.definitions().find((d) => d.name === 'whitelist')!
    expect(wl.options.map((o) => [o.name, o.type, 'required' in o])).toEqual([
      ['add', OptionType.SubCommand, false],
      ['remove', OptionType.SubCommand, false],
    ])
    expect((wl.options[0]!.options as { name: string; max_length?: number }[])[0]).toMatchObject({
      name: 'player',
      required: true,
      max_length: 16,
    })
  })
})

describe('/whitelist', () => {
  const add = (player: string, server?: string): Opt => ({
    name: 'add',
    type: OptionType.SubCommand,
    options: [str('player', player), ...(server ? [str('server', server)] : [])],
  })

  it('whitelists on the server picked, and logs it as via Discord', async () => {
    const { deps, log, calls } = fakeDeps()
    const res = await run(interaction('whitelist', ['100'], [add('Alex', 'survival')]), deps)
    expect(res.data.content).toBe('Whitelisted **Alex** on **Survival SMP**.')
    expect(res.data.flags).toBeUndefined()
    expect(res.data.allowed_mentions).toEqual({ parse: [] })
    expect(calls).toEqual(['whitelist add Alex on survival'])
    expect(log).toHaveLength(1)
    expect(log[0]!.action).toBe('players.whitelist-add')
    expect(auditActor(log[0]!.action, null, log[0]!.detail)).toBe('Steve via Discord')
    expect(describeAudit(log[0]!.action, log[0]!.target, log[0]!.detail)).toBe(
      'Whitelisted Alex on survival',
    )
  })

  it('takes players off with remove', async () => {
    const { deps, calls } = fakeDeps()
    const remove: Opt = { ...add('Alex', 'survival'), name: 'remove' }
    const res = await run(interaction('whitelist', ['100'], [remove]), deps)
    expect(res.data.content).toContain('Took **Alex** off')
    expect(calls).toEqual(['whitelist remove Alex on survival'])
  })

  it('needs the server when the caller looks after more than one', async () => {
    const { deps, calls } = fakeDeps()
    const res = await run(interaction('whitelist', ['100'], [add('Alex')]), deps)
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toContain('Which server?')
    expect(calls).toEqual([])
  })

  it('uses the only server a per-server role covers', async () => {
    const { deps, calls } = fakeDeps()
    await run(interaction('whitelist', ['200'], [add('Alex')]), deps)
    expect(calls).toEqual(['whitelist add Alex on creative'])
  })

  it('refuses a server the role does not cover, and logs the refusal', async () => {
    const { deps, calls } = fakeDeps()
    const refused: string[] = []
    const res = await run(interaction('whitelist', ['200'], [add('Alex', 'survival')]), deps, {
      refused,
    })
    expect(res.data.content).toContain('Sorry, you can’t use that')
    expect(refused).toEqual(['whitelist'])
    expect(calls).toEqual([])
  })

  it('answers a hidden server like one that does not exist', async () => {
    const { deps } = fakeDeps()
    const refused: string[] = []
    const res = await run(interaction('whitelist', ['200'], [add('Alex', 'secret')]), deps, {
      refused,
    })
    expect(res.data.content).toBe("There's no server called “secret”.")
    expect(refused).toEqual([])
  })

  it('refuses members without a mapped role, and viewers', async () => {
    for (const memberRoles of [[], ['300']]) {
      const { deps, calls, log } = fakeDeps()
      const refused: string[] = []
      const res = await run(
        interaction('whitelist', memberRoles, [add('Alex', 'survival')]),
        deps,
        {
          refused,
        },
      )
      expect(res.data.content).toContain('Sorry')
      expect(res.data.flags).toBe(EPHEMERAL)
      expect(refused).toEqual(['whitelist'])
      expect(calls).toEqual([])
      expect(log).toEqual([])
    }
  })

  it('refuses bad names and passes failures on privately', async () => {
    const { deps } = fakeDeps({
      whitelist: async () => {
        throw Object.assign(new Error('x'), {
          statusMessage: "There's no Minecraft account called Ghost.",
        })
      },
    })
    const bad = await run(interaction('whitelist', ['100'], [add('not a name', 'survival')]), deps)
    expect(bad.data.content).toContain('isn’t a valid Minecraft username')
    const failed = await run(interaction('whitelist', ['100'], [add('Ghost', 'survival')]), deps)
    expect(failed.data.flags).toBe(EPHEMERAL)
    expect(failed.data.content).toContain('no Minecraft account called Ghost')
  })
})

describe('/restart and /backup', () => {
  const settle = () => Bun.sleep(10)

  it('answers at once and follows up when the restart is done', async () => {
    const { deps, log, calls } = fakeDeps()
    const followUps: Reply[] = []
    const res = await run(interaction('restart', ['100'], [str('server', 'Survival SMP')]), deps, {
      followUps,
    })
    expect(res.type).toBe(ResponseType.ChannelMessage)
    expect(res.data.content).toContain('Restarting **Survival SMP**')
    await settle()
    expect(calls).toEqual(['restart survival'])
    expect(followUps.map((r) => r.content)).toEqual(['**Survival SMP** is back up.'])
    expect(log.map((l) => l.action)).toEqual(['server.restart'])
  })

  it('follows up with the reason when the restart fails', async () => {
    const { deps } = fakeDeps({
      restart: async () => {
        throw Object.assign(new Error('x'), { statusMessage: 'agent timed out' })
      },
    })
    const followUps: Reply[] = []
    await run(interaction('restart', ['100'], [str('server', 'survival')]), deps, { followUps })
    await settle()
    expect(followUps[0]!.content).toBe('Couldn’t restart **Survival SMP**: agent timed out')
  })

  it('backs up with a note and follows up with the result', async () => {
    const { deps, log, calls } = fakeDeps()
    const followUps: Reply[] = []
    const res = await run(
      interaction('backup', ['200'], [str('note', ' before the update ')]),
      deps,
      { followUps },
    )
    expect(res.data.content).toBe('Backing up **Creative**.')
    await settle()
    expect(calls).toEqual(['backup creative before the update'])
    expect(followUps[0]!.content).toBe('Backed up **Creative**. Backed up 12 MB.')
    expect(log[0]).toMatchObject({ action: 'backup.create', target: 'creative' })
  })

  it('says privately when the server is busy, and logs nothing', async () => {
    const { deps, log } = fakeDeps({
      backup: () => {
        throw Object.assign(new Error('x'), { statusMessage: 'Creative is busy restoring.' })
      },
    })
    const res = await run(interaction('backup', ['200']), deps)
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toContain('busy restoring')
    expect(log).toEqual([])
  })
})

describe('/say', () => {
  it('sends a tellraw that nothing in the message can break out of', async () => {
    const { deps, calls, log } = fakeDeps()
    const msg =
      'hi"},{"text":"x","clickEvent":{"action":"run_command","value":"/op Steve"}} @everyone'
    const res = await run(
      interaction('say', ['100'], [str('message', msg), str('server', 'survival')]),
      deps,
    )
    expect(res.data.allowed_mentions).toEqual({ parse: [] })
    const sent = calls[0]!.slice('survival: tellraw @a '.length)
    const parsed = JSON.parse(sent) as unknown[]
    expect(parsed).toHaveLength(4)
    expect(parsed[3]).toEqual({ text: msg })
    expect(parsed[2]).toEqual({ text: 'Steve: ', color: 'gray' })
    expect(log[0]).toMatchObject({ action: 'server.say', detail: { message: msg } })
  })

  it('strips control characters and section signs', () => {
    expect(cleanMessage('a\nb\u0000c §cred​ ')).toBe('a b c cred')
    expect(tellraw('A\nB', 'x')).toBe(
      'tellraw @a ["",{"text":"[Discord] ","color":"blue"},{"text":"A B: ","color":"gray"},{"text":"x"}]',
    )
  })

  it('says when the server is not running', async () => {
    const { deps, calls } = fakeDeps({ running: async () => false })
    const res = await run(
      interaction('say', ['100'], [str('message', 'hi'), str('server', 'survival')]),
      deps,
    )
    expect(res.data.content).toBe('**Survival SMP** isn’t running.')
    expect(calls).toEqual([])
  })
})

describe('posting a follow-up', () => {
  it('posts to the interaction webhook without the bot token, retrying once on 404', async () => {
    const { DiscordApi } = await import('../server/discord/api')
    const seen: { url: string; auth: string | null; body: string }[] = []
    let first = true
    const api = new DiscordApi(async (url, init) => {
      seen.push({
        url,
        auth: new Headers(init?.headers).get('authorization'),
        body: String(init?.body),
      })
      if (first) {
        first = false
        return new Response('{"message":"Unknown Webhook"}', { status: 404 })
      }
      return new Response('{}', { status: 200 })
    })
    await api.followUp('123', 'tok', { content: 'done', allowed_mentions: { parse: [] } })
    expect(seen).toHaveLength(2)
    expect(seen[1]!.url).toBe('https://discord.com/api/v10/webhooks/123/tok')
    expect(seen[1]!.auth).toBeNull()
    expect(JSON.parse(seen[1]!.body)).toEqual({ content: 'done', allowed_mentions: { parse: [] } })
  })
})
