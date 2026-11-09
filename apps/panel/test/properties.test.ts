import { describe, expect, it } from 'bun:test'
import { parseProperties, setProperties, stringifyProperties, toRecord } from '../server/properties'

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

  it('keeps CRLF files as CRLF', () => {
    const crlf = 'a=1\r\nb=2\r\n'
    expect(stringifyProperties(setProperties(parseProperties(crlf), { b: '3' }))).toBe(
      'a=1\r\nb=3\r\n',
    )
  })
})
