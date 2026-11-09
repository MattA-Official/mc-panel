import { describe, expect, it, vi } from 'vitest'
import { ServerName, verbs, lineSplitter, encode, MAX_LINE_BYTES, unitName } from './index.ts'

describe('ServerName', () => {
  it.each(['survival', 'creative-2', 'ab'])('accepts %s', (n) => {
    expect(ServerName.safeParse(n).success).toBe(true)
  })
  it.each(['', 'a', '2fast', 'Survival', 'has_underscore', 'trailing-', '../etc', 'a'.repeat(32)])(
    'rejects %j',
    (n) => {
      expect(ServerName.safeParse(n).success).toBe(false)
    },
  )
  it('builds the unit name', () => {
    expect(unitName('survival')).toBe('kiln-mc@survival.service')
  })
})

describe('verb params', () => {
  it('rejects unknown keys so nothing extra reaches root', () => {
    const r = verbs['service.start'].params.safeParse({ server: 'survival', extra: 'rm -rf /' })
    expect(r.success).toBe(false)
  })
  it('rejects privileged ports', () => {
    const r = verbs['server.create'].params.safeParse({
      name: 'survival',
      port: 80,
      memoryMb: 4096,
      javaMajor: 25,
    })
    expect(r.success).toBe(false)
  })
})

describe('lineSplitter', () => {
  it('reassembles lines split across chunks', () => {
    const lines: string[] = []
    const feed = lineSplitter(
      (l) => lines.push(l),
      () => {},
    )
    const msg = encode({ a: 1 }) + encode({ b: 2 })
    feed(msg.slice(0, 4))
    feed(msg.slice(4))
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ a: 1 }, { b: 2 }])
  })
  it('reports overflow for an over-long line', () => {
    const overflow = vi.fn()
    const feed = lineSplitter(() => {}, overflow)
    feed('x'.repeat(MAX_LINE_BYTES + 1))
    expect(overflow).toHaveBeenCalledOnce()
  })
})
