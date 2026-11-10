import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { compactSpec, isSecretProperty, memoryToMb, ServerSpec } from '../shared/spec'
import { specFromServer, typedValue } from '../server/spec/from-server'
import { lineOf, parseSpec, toYaml } from '../server/spec/yaml'

const row = {
  name: 'survival',
  displayName: 'Survival',
  loader: 'fabric' as const,
  mcVersion: '26.3',
  loaderVersion: '0.20.1',
  javaMajor: 25,
  memoryMb: 6144,
  port: 25565,
  rconPort: 25575,
  rconPassword: 'secret',
  eulaAcceptedAt: new Date(0),
  createdAt: new Date(0),
  backupSchedule: '0 4 * * *',
  backupTz: 'Europe/London',
  keepLast: 6,
  keepDaily: 7,
  keepWeekly: 4,
  content: [{ modrinth: 'lithium' }],
}

const props = {
  'server-port': '25565',
  'enable-rcon': 'true',
  'rcon.port': '25575',
  'rcon.password': 'secret',
  motd: 'Hello: world',
  'max-players': '20',
  'view-distance': '12',
  'white-list': 'true',
  'level-type': 'minecraft:normal',
  'level-seed': '-12345',
}

describe('spec', () => {
  test('a bare spec is valid and gets defaults', () => {
    const r = parseSpec('name: tiny\nloader:\n  type: vanilla\n  minecraft: "26.3"\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.spec.properties).toEqual({})
    expect(r.spec.content).toEqual([])
    expect(r.spec.backups).toBeUndefined()
  })

  test('a server becomes a spec that reads back the same', () => {
    const spec = specFromServer(row as never, props)
    expect(spec.properties).toEqual({
      'level-seed': -12345,
      motd: 'Hello: world',
      'view-distance': 12,
      'white-list': true,
    })
    const yaml = toYaml(spec, 'https://panel.example/schema/server-v1.json')
    expect(yaml).toStartWith('# yaml-language-server: $schema=https://panel.example/')
    expect(yaml).toContain('memory: 6G')
    expect(yaml).not.toContain('rcon')
    const back = parseSpec(yaml)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.spec).toEqual(spec)
  })

  test('a two-line MOTD with § codes reads back the same', () => {
    const motd = '§6§lNew Theatre §r§7Survival\n§bOpen to members'
    const spec = specFromServer(row as never, { ...props, motd })
    const yaml = toYaml(spec)
    expect(yaml).toContain('motd: "§6§lNew Theatre §r§7Survival\\n§bOpen to members"')
    const back = parseSpec(yaml)
    expect(back.ok && back.spec.properties['motd']).toBe(motd)
  })

  test('secrets never go into a spec', () => {
    const spec = specFromServer(row as never, {
      ...props,
      'management-server-enabled': 'true',
      'management-server-secret': 'hunter2hunter2',
      'future-thing.password': 'pw',
    })
    expect(spec.properties['management-server-enabled']).toBe(true)
    expect(Object.keys(spec.properties).filter(isSecretProperty)).toEqual([])
    expect(toYaml(spec, 'https://panel.example/schema/server-v1.json')).not.toContain('hunter2')
  })

  test('secret keys are known by name and by pattern', () => {
    for (const k of [
      'rcon.password',
      'management-server-secret',
      'some-new-secret',
      'proxy.password',
      'secret',
    ]) {
      expect(isSecretProperty(k)).toBe(true)
    }
    for (const k of [
      'management-server-enabled',
      'management-server-port',
      'secret-santa',
      'passwordless-login',
      'motd',
      'rcon.port',
    ]) {
      expect(isSecretProperty(k)).toBe(false)
    }
  })

  test('restarting when not responding reads back, and is left out when off', () => {
    const on = specFromServer({ ...row, restartWhenUnresponsive: true } as never, props)
    const yaml = toYaml(on, 'https://panel.example/schema/server-v1.json')
    expect(yaml).toContain('restartWhenUnresponsive: true')
    const back = parseSpec(yaml)
    expect(back.ok && back.spec.recovery).toEqual({ restartWhenUnresponsive: true })
    expect(specFromServer(row as never, props).recovery).toBeUndefined()
  })

  test('player stats settings read back, and are left out when on with nobody left out', () => {
    const stats = {
      enabled: false,
      leaveOut: [{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Steve' }],
    }
    const yaml = toYaml(
      specFromServer({ ...row, stats } as never, props),
      'https://panel.example/schema/server-v1.json',
    )
    expect(yaml).toContain('leaveOut:')
    const back = parseSpec(yaml)
    expect(back.ok && back.spec.stats).toEqual(stats)
    expect(specFromServer(row as never, props).stats).toBeUndefined()
    expect(
      specFromServer({ ...row, stats: { enabled: true, leaveOut: [] } } as never, props).stats,
    ).toBeUndefined()
  })

  test('map settings read back, and are left out at their defaults', () => {
    const map = { enabled: true, public: true, players: false }
    const yaml = toYaml(
      specFromServer({ ...row, map } as never, props),
      'https://panel.example/schema/server-v1.json',
    )
    expect(yaml).toContain('map:')
    const back = parseSpec(yaml)
    expect(back.ok && back.spec.map).toEqual(map)
    expect(specFromServer(row as never, props).map).toBeUndefined()
    expect(
      specFromServer(
        { ...row, map: { enabled: false, public: false, players: true } } as never,
        props,
      ).map,
    ).toBeUndefined()
  })

  test('compact specs leave defaults out', () => {
    const spec = ServerSpec.parse({ name: 'ab', loader: { type: 'vanilla', minecraft: '26.3' } })
    expect(compactSpec(spec)).toEqual({
      name: 'ab',
      loader: { type: 'vanilla', minecraft: '26.3' },
    })
  })

  test('hostnames are full DNS names, stored lower case', () => {
    const base = { name: 'ab', loader: { type: 'vanilla', minecraft: '26.3' } }
    expect(ServerSpec.parse({ ...base, hostname: 'Survival.Example.com' }).hostname).toBe(
      'survival.example.com',
    )
    expect(ServerSpec.parse({ ...base, hostname: null }).hostname).toBeNull()
    for (const bad of [
      'survival',
      'bad_name.example.com',
      '-x.example.com',
      'x.example.com:25565',
    ]) {
      expect(ServerSpec.safeParse({ ...base, hostname: bad }).success).toBe(false)
    }
  })

  test('memory', () => {
    expect(memoryToMb('4G')).toBe(4096)
    expect(memoryToMb('3584M')).toBe(3584)
    expect(memoryToMb('1.5G')).toBe(1536)
    expect(memoryToMb('4 GB')).toBe(4096)
    expect(memoryToMb('lots')).toBeNull()
    expect(memoryToMb(4096)).toBe(4096)
  })

  test('typed property values', () => {
    expect(typedValue('true')).toBe(true)
    expect(typedValue('20')).toBe(20)
    expect(typedValue('007')).toBe('007')
    expect(typedValue('1.5')).toBe('1.5')
  })

  const issues = (text: string) => {
    const r = parseSpec(text)
    if (r.ok) throw new Error('expected issues')
    return r.issues
  }

  test('an unquoted version says to quote it, on the right line', () => {
    const [i] = issues('name: ab\nloader:\n  type: fabric\n  minecraft: 1.20\n')
    expect(i!.path).toBe('loader.minecraft')
    expect(i!.message).toContain('quotes')
    expect(i!.line).toBe(4)
  })

  test('managed properties are refused', () => {
    const [i] = issues(
      'name: ab\nloader: { type: vanilla, minecraft: "26.3" }\nproperties:\n  motd: hi\n  server-port: 25570\n',
    )
    expect(i!.path).toBe('properties.server-port')
    expect(i!.message).toContain('"port"')
    expect(i!.line).toBe(5)
  })

  test('secret properties are refused on their own line', () => {
    const [i] = issues(
      'name: ab\nloader: { type: vanilla, minecraft: "26.3" }\nproperties:\n  motd: hi\n  management-server-secret: abc\n',
    )
    expect(i!.path).toBe('properties.management-server-secret')
    expect(i!.message).toContain('managed by Flytower')
    expect(i!.line).toBe(5)
  })

  test('content items are checked', () => {
    const list = issues(
      [
        'name: ab',
        'loader:',
        '  type: fabric',
        '  minecraft: "26.3"',
        'content:',
        '  - modrinth: lithium',
        '  - url: https://example.com/x.jar',
        '    sha256: nope',
        '    kind: mod',
      ].join('\n'),
    )
    expect(list.length).toBe(1)
    expect(list[0]!.line).toBeGreaterThanOrEqual(7)
  })

  test('http content is refused', () => {
    const r = parseSpec(
      `name: ab\nloader: { type: fabric, minecraft: "26.3" }\ncontent:\n  - url: http://x.test/a.jar\n    sha256: ${'a'.repeat(64)}\n    kind: mod\n`,
    )
    expect(r.ok).toBe(false)
  })

  test('bad schedules and zones are named', () => {
    const base = 'name: ab\nloader: { type: vanilla, minecraft: "26.3" }\nbackups:\n'
    expect(issues(`${base}  schedule: "not cron"\n`)[0]!.path).toBe('backups.schedule')
    const tz = issues(`${base}  schedule: "0 4 * * *"\n  timezone: Mars/Base\n`)[0]!
    expect(tz.path).toBe('backups.timezone')
    expect(tz.line).toBe(5)
  })

  test('memory out of range', () => {
    const [i] = issues('name: ab\nloader: { type: vanilla, minecraft: "26.3" }\nmemory: 512M\n')
    expect(i!.path).toBe('memory')
    expect(i!.line).toBe(3)
  })

  test('broken YAML and empty documents', () => {
    expect(issues('name: [ab\n')[0]!.message).toContain("isn't valid YAML")
    expect(issues('')[0]!.message).toContain('name and loader')
    expect(issues('name: ab\n')[0]!.path).toBe('loader')
  })

  test('unknown keys are refused', () => {
    const [i] = issues('name: ab\nloader: { type: vanilla, minecraft: "26.3" }\nram: 4G\n')
    expect(i!.message.toLowerCase()).toContain('ram')
  })

  test('lineOf finds nested keys and list items', () => {
    const text = '# c\nname: a\ncontent:\n  - modrinth: x\n  - url: y\n    sha256: z\n'
    expect(lineOf(text, ['name'])).toBe(2)
    expect(lineOf(text, ['content', 1])).toBe(5)
    expect(lineOf(text, ['content', 1, 'url'])).toBe(5)
    expect(lineOf(text, ['content', 1, 'sha256'])).toBe(6)
    expect(lineOf(text, ['content', 0, 'modrinth'])).toBe(4)
    expect(lineOf(text, ['missing'])).toBeUndefined()
  })

  test('the JSON Schema describes the input', () => {
    const schema = z.toJSONSchema(ServerSpec, { io: 'input', unrepresentable: 'any' }) as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(schema.required).toEqual(['name', 'loader'])
    expect(Object.keys(schema.properties)).toContain('content')
  })
})
