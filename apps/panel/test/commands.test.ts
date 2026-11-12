import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accept, complete, isReadyLine, trackPlayers, type Catalogue } from '../shared/commands'
import { helpPages, mergeHelp, parseHelp } from '../server/commands/help'
import { parseReports } from '../server/commands/reports'
import { CommandCatalogues, type CommandsDeps } from '../server/commands/service'

const fixture = (file: string) =>
  Bun.file(join(import.meta.dir, 'fixtures', 'commands', file)).json()

const commands26 = await fixture('commands-26.json')
const registries26 = await fixture('registries-26.json')
const vanilla = parseReports('26.3', commands26, registries26)

const cat = (extra: Partial<Catalogue> = {}): Catalogue => ({
  root: vanilla.root,
  registries: vanilla.registries,
  players: ['Steve', 'Alex'],
  ...extra,
})
const texts = (input: string, c = cat()) => complete(input, c).suggestions.map((s) => s.text)

describe('parseReports', () => {
  test('reads the 26.x tree', () => {
    const give = vanilla.root.literals!.give!
    const targets = give.args![0]!
    expect(targets).toMatchObject({ name: 'targets', type: 'entity', players: true, single: false })
    const item = targets.args![0]!
    expect(item).toMatchObject({ name: 'item', type: 'item_stack', run: true })
    expect(item.args![0]).toMatchObject({ name: 'count', type: 'integer', run: true })
  })

  test('keeps redirects, and sends `execute … run` back to the start', () => {
    expect(vanilla.root.literals!.tp!.redirect).toEqual(['teleport'])
    expect(vanilla.root.literals!.execute!.literals!.run!.redirect).toEqual([])
  })

  test('keeps the registries completion uses, without minecraft:', () => {
    expect(vanilla.registries.item).toContain('diamond_sword')
    expect(vanilla.registries.entity_type).toContain('pig')
    expect(Object.keys(vanilla.registries)).not.toContain('worldgen/structure_set')
  })

  test('reads the older shape too', () => {
    const old = parseReports(
      '1.21.4',
      {
        type: 'root',
        children: {
          kill: {
            type: 'literal',
            executable: true,
            children: {
              targets: {
                type: 'argument',
                parser: 'minecraft:entity',
                properties: { amount: 'multiple', type: 'entities' },
                executable: true,
              },
            },
          },
          tag: {
            type: 'literal',
            children: {
              name: {
                type: 'argument',
                parser: 'brigadier:string',
                properties: { type: 'word' },
                executable: true,
              },
            },
          },
        },
      },
      { 'minecraft:item': { entries: { 'minecraft:stone': { protocol_id: 1 } } } },
    )
    expect(old.root.literals!.kill!.args![0]).toMatchObject({
      type: 'entity',
      players: false,
      single: false,
    })
    expect(old.root.literals!.tag!.args![0]).toMatchObject({ type: 'string', string: 'word' })
    expect(old.registries.item).toEqual(['stone'])
  })

  test('refuses a report with no commands', () => {
    expect(() => parseReports('26.3', {}, {})).toThrow()
  })
})

describe('parseHelp', () => {
  test('splits vanilla and Fabric help, joined with no line breaks', () => {
    const reply =
      '/advancement (grant|revoke)/attribute <target> <attribute> (base|get|modifier)/chunky' +
      '/spark (profiler|health|tps)/list [uuids]'
    expect(parseHelp(reply)).toEqual([
      { name: 'advancement', usage: '(grant|revoke)' },
      { name: 'attribute', usage: '<target> <attribute> (base|get|modifier)' },
      { name: 'chunky', usage: '' },
      { name: 'spark', usage: '(profiler|health|tps)' },
      { name: 'list', usage: '[uuids]' },
    ])
  })

  test('reads Paper help and its pages', () => {
    const reply = [
      '--------- Help: Index (1/3) --------------------',
      'Use /help [n] to get page n of help.',
      'Aliases: Lists command aliases',
      '/advancement: A Mojang provided command.',
      '/essentials: Shows Essentials info.',
    ].join('\n')
    expect(helpPages(reply)).toBe(3)
    expect(parseHelp(reply)).toEqual([
      { name: 'advancement', usage: 'A Mojang provided command.' },
      { name: 'essentials', usage: 'Shows Essentials info.' },
    ])
  })

  test('adds only what vanilla lacks', () => {
    const merged = mergeHelp(vanilla.root, [
      { name: 'give', usage: '<targets> <item> [<count>]' },
      { name: 'spark', usage: '(profiler|health|tps)' },
    ])
    expect(merged.literals!.give).toBe(vanilla.root.literals!.give!)
    expect(merged.literals!.spark).toEqual({ run: true, usage: '(profiler|health|tps)' })
    expect(vanilla.root.literals!.spark).toBeUndefined()
  })
})

describe('complete', () => {
  test('suggests commands by their first letters', () => {
    expect(texts('gi')).toEqual(['give'])
    expect(texts('/ga')).toEqual(['gamemode', 'gamerule'])
    expect(complete('gi', cat()).hint).toBe('give <targets> <item> [<count>]')
  })

  test('suggests online players and selectors for players', () => {
    expect(texts('give ')).toEqual(['Steve', 'Alex', '@p', '@r', '@s', '@a'])
    expect(texts('give St')).toEqual(['Steve'])
    expect(complete('give St', cat()).hint).toBe('give <targets> <item> [<count>]')
  })

  test('suggests item ids, with or without minecraft:', () => {
    expect(texts('give Steve diamond')).toEqual(['diamond', 'diamond_sword'])
    expect(texts('give Steve sword')).toEqual(['diamond_sword'])
    expect(texts('give Steve minecraft:sto')).toEqual(['stone'])
    const c = complete('give Steve diamond', cat())
    expect(c.from).toBe('give Steve '.length)
    expect(c.hint).toBe('give <targets> <item> [<count>]')
  })

  test('shows the rest of the command once an argument is filled', () => {
    const c = complete('give Steve diamond ', cat())
    expect(c.suggestions).toEqual([])
    expect(c.hint).toBe('give <targets> <item> [<count>]')
  })

  test('follows redirects', () => {
    expect(texts('tp ')).toContain('Steve')
    expect(texts('execute as @a run gi')).toEqual(['give'])
    expect(texts('execute as @a run give @s ')).toContain('stone')
  })

  test('takes selectors with spaces in them as one word', () => {
    expect(texts('execute as @e[type=pig, limit=1] r')).toEqual(['run'])
  })

  test('suggests coordinates, which take three words', () => {
    expect(texts('tp ~')).toContain('~ ~ ~')
    expect(complete('tp 10 ', cat()).hint).toContain('<location>')
    expect(texts('tp Steve ')).toContain('Alex')
  })

  test('suggests fixed values and named sets', () => {
    expect(texts('gamemode ')).toEqual(['survival', 'creative', 'adventure', 'spectator'])
    expect(texts('summon zo')).toEqual(['zombie'])
    expect(texts('summon pl')).toEqual([])
  })

  test('a message takes the rest of the line', () => {
    const c = complete('say hello there', cat())
    expect(c.suggestions).toEqual([])
    expect(c.hint).toBe('say <message>')
  })

  test('mod commands complete by name and show their usage', () => {
    const root = mergeHelp(vanilla.root, [{ name: 'spark', usage: '(profiler|health|tps)' }])
    const c = complete('sp', cat({ root }))
    expect(c.suggestions[0]).toEqual({ text: 'spark', detail: '(profiler|health|tps)' })
    expect(c.hint).toBe('spark (profiler|health|tps)')
    expect(complete('spark pro', cat({ root })).hint).toBe('spark (profiler|health|tps)')
  })

  test('says nothing about commands it does not know', () => {
    expect(complete('nosuch thing', cat())).toEqual({
      from: 12,
      typed: '',
      suggestions: [],
      hint: null,
    })
  })

  test('works with only help to go on', () => {
    const root = mergeHelp(null, parseHelp('/list/stop/spark'))
    expect(texts('s', cat({ root, registries: {} }))).toEqual(['spark', 'stop'])
  })

  test('accept puts the suggestion in place of the word being typed', () => {
    const c = complete('give Steve dia', cat())
    expect(accept('give Steve dia', c, c.suggestions[0]!)).toBe('give Steve diamond ')
    expect(accept('give Steve dia', c, c.suggestions[0]!, false)).toBe('give Steve diamond')
  })
})

describe('console lines', () => {
  test('tracks joins and leaves', () => {
    const lines = [
      '[12:00:00] [Server thread/INFO]: Notch joined the game',
      '[12:00:01] [Server thread/INFO]: Steve left the game',
      '[12:00:02] [Server thread/INFO]: <Alex> Bob joined the game',
    ]
    expect(trackPlayers(['Steve', 'Alex'], lines)).toEqual(['Alex', 'Notch'])
  })

  test('sees the server finish starting', () => {
    expect(isReadyLine('[12:00:00] [Server thread/INFO]: Done (3.2s)! For help, type "help"')).toBe(
      true,
    )
    expect(isReadyLine('[12:00:00] [Server thread/INFO]: <Bob> Done (3.2s)!')).toBe(false)
  })
})

describe('CommandCatalogues', () => {
  async function setup(over: Partial<CommandsDeps> = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'flytower-commands-'))
    let builds = 0
    let helps = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const c = new CommandCatalogues({
      dir,
      server: (name) => (name === 'survival' ? { minecraft: '26.3', javaMajor: 25 } : null),
      async makeReports() {
        builds++
        await gate
        return { commands: commands26, registries: registries26 }
      },
      async command(_name, command) {
        helps++
        return command === 'help' ? '/give <targets> <item>/spark (profiler|tps)' : ''
      },
      online: async () => ({ running: true, players: ['Steve'] }),
      ...over,
    })
    /** Lets any build finish before the folder goes, so none outlives its test. */
    const cleanUp = async () => {
      release()
      await c.get('survival', { wait: true }).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
    return { c, dir, release, cleanUp, builds: () => builds, helps: () => helps }
  }

  test('builds the tree once, while consoles carry on with help', async () => {
    const t = await setup()
    try {
      const first = await t.c.get('survival')
      expect(first).toMatchObject({ vanilla: 'building', extra: 'ready', players: ['Steve'] })
      expect(Object.keys(first!.root.literals!)).toEqual(['give', 'spark'])
      const waiting = t.c.get('survival', { wait: true })
      expect((await t.c.get('survival'))!.vanilla).toBe('building')
      t.release()
      const ready = await waiting
      expect(ready!.vanilla).toBe('ready')
      expect(ready!.root.literals!.execute).toBeDefined()
      expect(ready!.root.literals!.spark).toEqual({ run: true, usage: '(profiler|tps)' })
      expect(t.builds()).toBe(1)
      expect(t.helps()).toBe(1)
      expect(await readdir(t.dir)).toEqual(['26.3.json'])
    } finally {
      await rm(t.dir, { recursive: true, force: true })
    }
  })

  test('reads a kept tree without building it again', async () => {
    const t = await setup()
    try {
      t.release()
      await t.c.get('survival', { wait: true })
      const again = await setup({ dir: t.dir })
      again.release()
      expect((await again.c.get('survival', { wait: true }))!.vanilla).toBe('ready')
      expect(again.builds()).toBe(0)
      await rm(again.dir, { recursive: true, force: true })
    } finally {
      await rm(t.dir, { recursive: true, force: true })
    }
  })

  test('asks help again after a restart', async () => {
    const t = await setup()
    try {
      await t.c.get('survival')
      await t.c.get('survival')
      expect(t.helps()).toBe(1)
      t.c.forgetRun('survival')
      await t.c.get('survival')
      expect(t.helps()).toBe(2)
    } finally {
      await rm(t.dir, { recursive: true, force: true })
    }
  })

  test('falls back to help when the reports fail, and waits before trying again', async () => {
    let now = 0
    const t = await setup({
      makeReports: async () => {
        throw new Error('no Java')
      },
      now: () => now,
      retryMs: 1000,
    })
    const error = console.error
    console.error = () => {}
    try {
      const view = await t.c.get('survival', { wait: true })
      expect(view).toMatchObject({ vanilla: 'unavailable', extra: 'ready' })
      expect(Object.keys(view!.root.literals!)).toEqual(['give', 'spark'])
      expect((await t.c.get('survival'))!.vanilla).toBe('unavailable')
      now = 2000
      expect((await t.c.get('survival'))!.vanilla).toBe('building')
      expect(await readdir(t.dir)).toEqual([])
    } finally {
      console.error = error
      await rm(t.dir, { recursive: true, force: true })
    }
  })

  test('a server that is off has no help, and an unknown server has nothing', async () => {
    const t = await setup({ online: async () => ({ running: false, players: [] }) })
    try {
      expect((await t.c.get('survival'))!.extra).toBe('unavailable')
      expect(t.helps()).toBe(0)
      expect(await t.c.get('creative')).toBeNull()
    } finally {
      await t.cleanUp()
    }
  })

  test('a console that does not answer is asked again next time', async () => {
    let fail = true
    const t = await setup({
      command: async () => {
        if (fail) throw new Error('RCON is down')
        return '/spark'
      },
    })
    try {
      expect((await t.c.get('survival'))!.extra).toBe('unavailable')
      fail = false
      expect((await t.c.get('survival'))!.extra).toBe('ready')
    } finally {
      await t.cleanUp()
    }
  })
})
