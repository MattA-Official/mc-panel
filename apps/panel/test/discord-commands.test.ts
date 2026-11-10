import { describe, expect, it } from 'bun:test'
import { openDb } from '../server/db'
import { sealer } from '../server/backups/offsite'
import { DiscordService } from '../server/discord/service'
import { CommandRegistry, OptionType, route } from '../server/discord/registry'
import {
  EPHEMERAL,
  InteractionType,
  ResponseType,
  type Interaction,
} from '../server/discord/interactions'
import {
  playersCommand,
  playersText,
  serverChoices,
  statusCommand,
  statusEmbed,
  visibleServers,
  type ServerSource,
} from '../server/discord/commands/servers'
import { NO_ACCESS, foldGrants, type Access } from '../shared/permissions'
import type { PublicStatus } from '../shared/public-page'

const base: PublicStatus = {
  name: 'survival',
  displayName: 'Survival SMP',
  description: 'Be *nice*.',
  motd: '',
  icon: '/api/public/servers/survival/icon?v=1',
  address: 'mc.example.com',
  state: 'online',
  players: {
    count: 2,
    max: 20,
    list: [
      { name: '__Steve__', uuid: 'a' },
      { name: 'Alex', uuid: 'b' },
    ],
  },
  version: { minecraft: '1.21.10', loader: 'Fabric' },
  pack: null,
}

function source(
  over: Partial<Record<string, PublicStatus>> = {},
  delayMs = 0,
): ServerSource & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    servers: () => [
      { name: 'survival', displayName: 'Survival SMP', public: true },
      { name: 'creative', displayName: 'Creative', public: true },
      { name: 'staff', displayName: 'Staff test', public: false },
    ],
    async status(name) {
      asked.push(name)
      if (delayMs) await Bun.sleep(delayMs)
      return (
        over[name] ?? {
          ...base,
          name,
          displayName: name === 'creative' ? 'Creative' : base.displayName,
        }
      )
    },
    origin: () => 'https://panel.example.com',
  }
}

const command = (
  name: string,
  options: { name: string; value: string; focused?: boolean }[] = [],
  type: number = InteractionType.ApplicationCommand,
): Interaction => ({
  id: '1',
  type,
  application_id: '123',
  token: 't',
  guild_id: '9',
  member: { user: { id: '42' }, roles: ['7'] },
  data: { name, options: options.map((o) => ({ ...o, type: OptionType.String })) },
})

function registry(src = source()) {
  return new CommandRegistry().add(statusCommand(src, 100)).add(playersCommand(src, 100))
}

type Resp = {
  type: number
  data: {
    content?: string
    embeds?: Record<string, unknown>[]
    flags?: number
    choices?: unknown[]
    allowed_mentions?: unknown
  }
}
const run = async (i: Interaction, reg = registry(), access: Access = NO_ACCESS) =>
  (await route(reg, i, () => access)) as Resp

describe('the command registry', () => {
  it('refuses bad and duplicate names', () => {
    const r = new CommandRegistry()
    const cmd = { name: 'ok', description: 'd', permission: 'public' as const, handle: () => ({}) }
    r.add(cmd)
    expect(() => r.add(cmd)).toThrow('already registered')
    expect(() => r.add({ ...cmd, name: 'Bad Name' })).toThrow('Bad command name')
    expect(() => r.add({ ...cmd, name: 'x', description: '' })).toThrow('description')
  })

  it('gives Discord a sorted list whose hash follows changes', () => {
    const r = registry()
    expect(r.definitions().map((d) => d.name)).toEqual(['players', 'status'])
    expect(r.definitions()[1]!.options[0]).toMatchObject({
      name: 'server',
      autocomplete: true,
      required: false,
    })
    const before = r.hash()
    expect(registry().hash()).toBe(before)
    r.add({ name: 'extra', description: 'More', permission: 'public', handle: () => ({}) })
    expect(r.hash()).not.toBe(before)
  })

  it('routes a command to its handler with its options and caller', async () => {
    let seen: unknown
    const r = new CommandRegistry().add({
      name: 'echo',
      description: 'Echo',
      permission: 'public',
      handle: (ctx) => {
        seen = { options: ctx.options, user: ctx.discordUserId, roles: ctx.discordRoleIds }
        return { content: '@everyone hi', ephemeral: true }
      },
    })
    const res = await run(command('echo', [{ name: 'text', value: 'hi' }]), r)
    expect(seen).toEqual({ options: { text: 'hi' }, user: '42', roles: ['7'] })
    expect(res).toEqual({
      type: ResponseType.ChannelMessage,
      data: { content: '@everyone hi', flags: EPHEMERAL, allowed_mentions: { parse: [] } },
    })
  })

  it('keeps commands that need a permission from people without it', async () => {
    let ran = false
    const r = new CommandRegistry().add({
      name: 'restart',
      description: 'Restart',
      permission: 'server.power',
      handle: () => ((ran = true), {}),
    })
    const res = await run(command('restart'), r)
    expect(ran).toBe(false)
    expect(res.data.flags).toBe(EPHEMERAL)
    await run(
      command('restart'),
      r,
      foldGrants([{ server: 'survival', permissions: ['server.view', 'server.power'] }]),
    )
    expect(ran).toBe(true)
  })

  it('answers privately when a handler throws', async () => {
    const r = new CommandRegistry().add({
      name: 'boom',
      description: 'Boom',
      permission: 'public',
      handle: () => {
        throw new Error('nope')
      },
    })
    const orig = console.error
    console.error = () => {}
    const res = await run(command('boom'), r)
    console.error = orig
    expect(res.data).toMatchObject({
      flags: EPHEMERAL,
      content: expect.stringContaining('went wrong'),
    })
  })

  it('answers PING, and unknown commands privately', async () => {
    expect(
      await run({ id: '1', type: InteractionType.Ping, application_id: '1', token: 't' }),
    ).toEqual({ type: ResponseType.Pong } as never)
    expect((await run(command('gone'))).data.flags).toBe(EPHEMERAL)
    expect(await run(command('gone', [], InteractionType.Autocomplete))).toEqual({
      type: ResponseType.AutocompleteResult,
      data: { choices: [] },
    })
  })
})

describe('which servers Discord sees', () => {
  it('shows public servers, and others only with access', () => {
    const src = source()
    expect(visibleServers(src, NO_ACCESS).map((s) => s.name)).toEqual(['creative', 'survival'])
    const staff = foldGrants([{ server: 'staff', permissions: ['server.view'] }])
    expect(visibleServers(src, staff).map((s) => s.name)).toEqual(['creative', 'staff', 'survival'])
  })

  it('autocompletes only visible servers, by name or display name', async () => {
    const res = await run(
      command(
        'status',
        [{ name: 'server', value: 'st', focused: true }],
        InteractionType.Autocomplete,
      ),
    )
    expect(res.data.choices).toEqual([])
    const all = await run(
      command(
        'status',
        [{ name: 'server', value: '', focused: true }],
        InteractionType.Autocomplete,
      ),
    )
    expect(all.data.choices).toEqual([
      { name: 'Creative', value: 'creative' },
      { name: 'Survival SMP', value: 'survival' },
    ])
    expect(serverChoices(visibleServers(source(), NO_ACCESS), 'smp')).toEqual([
      { name: 'Survival SMP', value: 'survival' },
    ])
  })

  it('answers a hidden server like one that doesn’t exist, without asking for it', async () => {
    const src = source()
    const hidden = await run(command('status', [{ name: 'server', value: 'staff' }]), registry(src))
    const missing = await run(command('status', [{ name: 'server', value: 'nope' }]), registry(src))
    expect(hidden.data.content).toBe("There's no server called “staff”.")
    expect(missing.data.content).toBe("There's no server called “nope”.")
    expect(hidden.data.flags).toBe(EPHEMERAL)
    expect(src.asked).toEqual([])
  })
})

describe('/status', () => {
  it('shows one server as an embed', async () => {
    const res = await run(command('status', [{ name: 'server', value: 'survival' }]))
    expect(res.data.flags).toBeUndefined()
    expect(res.data.embeds).toEqual([
      {
        title: 'Survival SMP',
        color: 0x1f7a4f,
        description: 'Be \\*nice\\*.',
        fields: [
          { name: 'Status', value: 'Online', inline: true },
          { name: 'Address', value: '`mc.example.com`', inline: true },
          { name: 'Players', value: '2 of 20', inline: true },
          { name: 'Version', value: 'Fabric 1.21.10', inline: true },
        ],
        thumbnail: { url: 'https://panel.example.com/api/public/servers/survival/icon?v=1' },
      },
    ])
  })

  it('shows every visible server without one named', async () => {
    const res = await run(command('status'))
    expect(res.data.embeds!.map((e) => e.title)).toEqual(['Creative', 'Survival SMP'])
  })

  it('leaves out what the public page hides', () => {
    const e = statusEmbed(
      { ...base, state: 'offline', players: null, version: null, description: '', icon: null },
      null,
    )
    expect(e).toEqual({
      title: 'Survival SMP',
      color: 0xc23535,
      fields: [
        { name: 'Status', value: 'Offline', inline: true },
        { name: 'Address', value: '`mc.example.com`', inline: true },
      ],
    })
  })

  it('says it’s still checking rather than miss Discord’s deadline', async () => {
    const res = await run(
      command('status', [{ name: 'server', value: 'survival' }]),
      registry(source({}, 300)),
    )
    expect(res.data).toMatchObject({
      content: 'Still checking. Try again in a moment.',
      flags: EPHEMERAL,
    })
  })

  it('says so when nothing is shared', async () => {
    const empty: ServerSource = { ...source(), servers: () => [] }
    const res = await run(command('status'), registry(empty as never))
    expect(res.data.content).toContain('No servers are shared here yet')
  })
})

describe('/players', () => {
  it('lists names, escaped, with mentions off', async () => {
    const res = await run(command('players', [{ name: 'server', value: 'survival' }]))
    expect(res.data.content).toBe('**Survival SMP**: 2 of 20 online: \\_\\_Steve\\_\\_, Alex')
    expect(res.data.allowed_mentions).toEqual({ parse: [] })
  })

  it('follows the page: count only, nothing, nobody, or not up', () => {
    expect(playersText({ ...base, players: { count: 3, max: null } })).toBe(
      '**Survival SMP**: 3 online.',
    )
    expect(playersText({ ...base, players: null })).toBe("**Survival SMP** doesn't share who's on.")
    expect(playersText({ ...base, players: { count: 0, max: 20, list: [] } })).toBe(
      "**Survival SMP**: nobody's on.",
    )
    expect(playersText({ ...base, state: 'starting' })).toBe('**Survival SMP** is starting.')
  })
})

describe('sending the commands to Discord', () => {
  const TOKEN = [
    'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ',
    'GaBcDe',
    'abcdefghijklmnopqrstuvwxyz0123456789',
  ].join('.')

  function setup(fail = false) {
    const puts: unknown[] = []
    const seal = sealer(async () => 'cd'.repeat(32))
    const svc = new DiscordService({
      db: openDb(':memory:'),
      seal: seal.seal,
      unseal: seal.unseal,
      origin: () => 'https://panel.example.com',
      commandNames: () => ['players', 'status'],
      fetch: async (url, init = {}) => {
        if (init.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)))
          if (fail) return Response.json({ message: 'Missing Access' }, { status: 403 })
          return Response.json([])
        }
        return Response.json({ id: '123456789012345678', name: 'Bot', verify_key: 'ab'.repeat(32) })
      },
    })
    return { svc, puts }
  }

  it('sends only when the list changed', async () => {
    const { svc, puts } = setup()
    expect(await svc.syncCommands([], 'h')).toBe('no-app')
    await svc.connect(TOKEN)
    const defs = registry().definitions()
    expect(await svc.syncCommands(defs, 'h1')).toBe('sent')
    expect(await svc.syncCommands(defs, 'h1')).toBe('unchanged')
    expect(await svc.syncCommands(defs, 'h2')).toBe('sent')
    expect(await svc.syncCommands(defs, 'h2', true)).toBe('sent')
    expect(puts).toHaveLength(3)
    expect(svc.state()).toMatchObject({ commands: ['players', 'status'], commandsError: null })
  })

  it('records a failure for the card, and tries again next time', async () => {
    const { svc, puts } = setup(true)
    await svc.connect(TOKEN)
    expect(await svc.syncCommands([], 'h1')).toBe('failed')
    expect(svc.state()).toMatchObject({ commandsError: 'Discord answered 403: Missing Access' })
    expect(await svc.syncCommands([], 'h1')).toBe('failed')
    expect(puts).toHaveLength(2)
  })
})
