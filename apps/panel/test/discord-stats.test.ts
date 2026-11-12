import { describe, expect, it } from 'bun:test'
import { CommandRegistry, OptionType, route } from '../server/discord/registry'
import { EPHEMERAL, InteractionType, type Interaction } from '../server/discord/interactions'
import {
  leaderboardCommand,
  playerEmbed,
  publicPlayerNames,
  publicPlayerStats,
  statsCommand,
  type PlayerStats,
  type StatsSource,
} from '../server/discord/commands/stats'
import { NO_ACCESS, can, foldGrants, type Access } from '../shared/permissions'
import type { Board, Period } from '../shared/leaderboards'

const zero = { playtime: 0, deaths: 0, mob_kills: 0, distance: 0, blocks_mined: 0 }
const board = (key: Board['key'], entries: [string, number][]): Board => ({
  key,
  label: key === 'deaths' ? 'Deaths' : 'Playtime',
  unit: key === 'deaths' ? 'count' : 'time',
  entries: entries.map(([name, value], i) => ({ rank: i + 1, uuid: `u-${name}`, name, value })),
})

/** survival shares leaderboards publicly; staff only shows to people who can see it. */
function source(asked: { period?: Period }[] = []): StatsSource {
  const sees = (server: string, access: Access) =>
    server === 'survival' || can(access, 'server.view', server)
  return {
    servers: (access) =>
      [
        { name: 'survival', displayName: 'Survival SMP', public: true },
        { name: 'staff', displayName: 'Staff test', public: true },
      ].filter((s) => sees(s.name, access)),
    async boards(server, period, access) {
      asked.push({ period })
      if (!sees(server, access)) return null
      return {
        since: period === 'week' ? '2026-11-09' : null,
        boards: [
          board('playtime', [['__Steve__', 72_000 * 3]]),
          board('deaths', [
            ['Alex', 4],
            ['Steve', 2],
          ]),
        ],
      }
    },
    async player(server, name, access): Promise<PlayerStats | null> {
      if (!sees(server, access) || name.toLowerCase() !== 'alex') return null
      return {
        name: 'Alex',
        uuid: 'u-alex',
        allTime: { ...zero, deaths: 4, playtime: 72_000 },
        week: { ...zero, deaths: 1 },
        ...(can(access, 'server.view', server) && { lastSeen: 1_794_000_000_000, sessions: 3 }),
      }
    },
    playerNames: async (server, access) => (sees(server, access) ? ['Alex', 'Steve'] : []),
  }
}

const interaction = (
  name: string,
  options: { name: string; value: string; focused?: boolean }[] = [],
  type: number = InteractionType.ApplicationCommand,
): Interaction => ({
  id: '1',
  type,
  application_id: '123',
  token: 't',
  guild_id: '9',
  member: { user: { id: '42' }, roles: [] },
  data: { name, options: options.map((o) => ({ ...o, type: OptionType.String })) },
})

interface Embed {
  title?: string
  description?: string
  footer: { text: string }
  fields: { name: string; value: string }[]
}
type Resp = {
  data: { content?: string; embeds?: Embed[]; flags?: number; choices?: unknown[] }
}
const registry = (src = source()) =>
  new CommandRegistry().add(leaderboardCommand(src, 200)).add(statsCommand(src, 200))
const run = async (i: Interaction, access: Access = NO_ACCESS, reg = registry()) =>
  (await route(reg, i, () => access)) as Resp
const viewer = foldGrants([{ server: 'staff', permissions: ['server.view'] }])

describe('/leaderboard', () => {
  it('offers the boards and periods as fixed choices', () => {
    const def = registry()
      .definitions()
      .find((d) => d.name === 'leaderboard')!
    const opts = def.options as { name: string; choices?: { value: string }[] }[]
    expect(opts.find((o) => o.name === 'stat')!.choices!.map((c) => c.value)).toEqual([
      'playtime',
      'deaths',
      'mob_kills',
      'distance',
      'blocks_mined',
    ])
    expect(opts.find((o) => o.name === 'period')!.choices!.map((c) => c.value)).toEqual([
      'all',
      'month',
      'week',
    ])
  })

  it('shows playtime for all time on the only public server by default', async () => {
    const res = await run(interaction('leaderboard'))
    const e = res.data.embeds![0]!
    expect(e.title).toBe('Survival SMP · Playtime')
    // Names are escaped so underscores don't turn into italics.
    expect(e.description).toBe('**1.** \\_\\_Steve\\_\\_ · 3 h')
    expect(e.footer.text).toStartWith('All time')
  })

  it('takes a stat and period', async () => {
    const asked: { period?: Period }[] = []
    const res = await run(
      interaction('leaderboard', [
        { name: 'stat', value: 'deaths' },
        { name: 'period', value: 'week' },
      ]),
      NO_ACCESS,
      registry(source(asked)),
    )
    expect(asked).toEqual([{ period: 'week' }])
    const e = res.data.embeds![0]!
    expect(e.title).toBe('Survival SMP · Deaths')
    expect(e.description).toBe('**1.** Alex · 4\n**2.** Steve · 2')
    expect(e.footer.text).toStartWith('This week, since 9 Nov')
  })

  it("answers a server the caller can't see like one that doesn't exist", async () => {
    const res = await run(interaction('leaderboard', [{ name: 'server', value: 'staff' }]))
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toContain('no stats for a server called “staff”')
  })

  it('asks which server when the caller can see more than one', async () => {
    const res = await run(interaction('leaderboard'), viewer)
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toBe('Pick a server: Survival SMP, Staff test.')
    const picked = await run(
      interaction('leaderboard', [{ name: 'server', value: 'staff' }]),
      viewer,
    )
    expect(picked.data.embeds![0]!.title).toBe('Staff test · Playtime')
  })

  it('only suggests servers the caller can see', async () => {
    const res = await run(
      interaction('leaderboard', [{ name: 'server', value: '', focused: true }], 4),
    )
    expect(res.data.choices).toEqual([{ name: 'Survival SMP', value: 'survival' }])
  })
})

describe('/stats', () => {
  it("shows a player's figures without visits to the public", async () => {
    const res = await run(interaction('stats', [{ name: 'player', value: 'ALEX' }]))
    const e = res.data.embeds![0]!
    expect(e.title).toBe('Alex on Survival SMP')
    expect(e.description).toBeUndefined()
    const deaths = e.fields.find((f) => f.name === 'Deaths')!
    expect(deaths.value).toBe('4\n+1 this week')
    expect(e.fields.find((f) => f.name === 'Playtime')!.value).toBe('1 h')
  })

  it('adds visits for people who can see the server', async () => {
    const res = await run(
      interaction('stats', [
        { name: 'player', value: 'alex' },
        { name: 'server', value: 'staff' },
      ]),
      viewer,
    )
    expect(res.data.embeds![0]!.description).toBe('3 visits, last seen <t:1794000000:R>')
  })

  it('says privately when there is nobody by that name', async () => {
    const res = await run(interaction('stats', [{ name: 'player', value: 'Herobrine' }]))
    expect(res.data.flags).toBe(EPHEMERAL)
    expect(res.data.content).toBe('No stats for “Herobrine” on Survival SMP.')
  })

  it('suggests player names as they type', async () => {
    const res = await run(interaction('stats', [{ name: 'player', value: 'st', focused: true }], 4))
    expect(res.data.choices).toEqual([{ name: 'Steve', value: 'Steve' }])
  })
})

describe('/stats for the public', () => {
  const boards = {
    all: [
      board('playtime', [
        ['Steve', 216_000],
        ['Alex', 72_000],
      ]),
      board('deaths', [['Steve', 2]]),
    ],
    month: [board('deaths', [['Notch', 1]])],
    week: [board('deaths', [['Alex', 1]])],
  }

  it('only offers players on the public leaderboards', () => {
    expect(publicPlayerNames(boards).sort()).toEqual(['Alex', 'Steve'])
    expect(publicPlayerNames({ all: null })).toEqual([])
  })

  it('only shows the figures on the boards they are placed on', () => {
    const alex = publicPlayerStats(boards, 'alex')!
    expect(alex).toEqual({
      name: 'Alex',
      uuid: 'u-Alex',
      allTime: { playtime: 72_000 },
      week: { deaths: 1 },
      partial: true,
    })
    const e = playerEmbed({ name: 'survival', displayName: 'Survival SMP', public: true }, alex)
    expect(e.fields).toEqual([
      { name: 'Playtime', value: '1 h', inline: true },
      { name: 'Deaths', value: '+1 this week', inline: true },
    ])
    expect(e.footer.text).toBe('Their places on the public leaderboards. Updated once a day.')
    // Someone on no public board /stats covers isn't there at all.
    expect(publicPlayerStats(boards, 'Herobrine')).toBeNull()
    expect(publicPlayerStats(boards, 'Notch')).toBeNull()
  })
})
