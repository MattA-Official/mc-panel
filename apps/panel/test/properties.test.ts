import { describe, expect, it } from 'bun:test'
import {
  parseProperties,
  refuseManagedEdits,
  setProperties,
  stringifyProperties,
  toRecord,
  withoutSecrets,
} from '../server/properties'

const SAMPLE = `#Minecraft server properties
#Mon Nov 09 13:07:31 UTC 2026
accepts-transfers=false
allow-flight=false
difficulty=easy
level-seed=
motd=Caf\\u00e9 \\: the \\= best
max-players=20
custom-key = spaced value
continued=one \\
    two
server-port=25565
`

describe('properties', () => {
  it('reads values, including escapes and continuations', () => {
    const r = toRecord(parseProperties(SAMPLE))
    expect(r['motd']).toBe('Café : the = best')
    expect(r['level-seed']).toBe('')
    expect(r['custom-key']).toBe('spaced value')
    expect(r['continued']).toBe('one two')
    expect(r['max-players']).toBe('20')
  })

  it('round-trips byte for byte when nothing changes', () => {
    expect(stringifyProperties(parseProperties(SAMPLE))).toBe(SAMPLE)
    expect(
      stringifyProperties(setProperties(parseProperties(SAMPLE), { difficulty: 'easy' })),
    ).toBe(SAMPLE)
  })

  it('rewrites only changed lines and appends new keys', () => {
    const out = stringifyProperties(
      setProperties(parseProperties(SAMPLE), {
        difficulty: 'hard',
        motd: 'Hello: wörld #1',
        'new-key': 'x',
      }),
    )
    expect(out).toContain('difficulty=hard\n')
    expect(out).toContain('motd=Hello\\: w\\u00f6rld \\#1\n')
    expect(out).toContain('#Minecraft server properties\n')
    expect(out).toContain('custom-key = spaced value\n')
    expect(out.trimEnd().endsWith('new-key=x')).toBe(true)
    expect(toRecord(parseProperties(out))['motd']).toBe('Hello: wörld #1')
  })

  it('writes a two-line motd with its codes on one line, and reads it back', () => {
    const motd = '§6§lNew Theatre §r§7Survival\n§bOpen to members: join on Discord'
    const out = stringifyProperties(setProperties(parseProperties(SAMPLE), { motd }))
    expect(out).toContain(
      'motd=\\u00a76\\u00a7lNew Theatre \\u00a7r\\u00a77Survival\\n\\u00a7bOpen to members\\: join on Discord\n',
    )
    expect(out.split('\n').filter((l) => l.startsWith('motd=')).length).toBe(1)
    expect(toRecord(parseProperties(out))['motd']).toBe(motd)
  })

  it('reads § written by hand, raw or escaped', () => {
    const r = toRecord(parseProperties('motd=§aHi\\n\\u00A7cthere\n'))
    expect(r['motd']).toBe('§aHi\n§cthere')
  })

  it('keeps CRLF files as CRLF', () => {
    const crlf = 'a=1\r\nb=2\r\n'
    expect(stringifyProperties(setProperties(parseProperties(crlf), { b: '3' }))).toBe(
      'a=1\r\nb=3\r\n',
    )
  })
})

describe('secrets in the properties API', () => {
  const ON_DISK =
    'motd=Hi\nrcon.password=rconpw\nmanagement-server-enabled=true\nmanagement-server-secret=mgmtsecret\n'

  it('GET leaves every secret out', () => {
    const values = withoutSecrets(toRecord(parseProperties(ON_DISK)))
    expect(values).toEqual({ motd: 'Hi', 'management-server-enabled': 'true' })
    expect(JSON.stringify(values)).not.toContain('secret=')
  })

  it('PATCH refuses secrets and managed keys, and allows the rest', () => {
    expect(refuseManagedEdits(['motd', 'management-server-enabled'])).toBeNull()
    expect(refuseManagedEdits(['management-server-secret'])).toBe(
      'management-server-secret is managed by Flytower.',
    )
    expect(refuseManagedEdits(['rcon.port', 'a-new-secret'])).toBe(
      'rcon.port, a-new-secret are managed by Flytower.',
    )
  })

  it('editing other properties keeps the secret on disk', () => {
    const out = stringifyProperties(setProperties(parseProperties(ON_DISK), { motd: 'Bye' }))
    expect(out).toContain('management-server-secret=mgmtsecret\n')
    expect(out).toContain('rcon.password=rconpw\n')
    expect(out).toContain('motd=Bye\n')
  })
})
