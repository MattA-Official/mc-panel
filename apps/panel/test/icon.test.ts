import { describe, expect, it } from 'bun:test'
import { deflateSync } from 'node:zlib'
import { cleanIcon, crc32, MAX_ICON_BYTES } from '../server/icon'

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function png({
  size = 64,
  extra = [] as Uint8Array[],
  pixels,
}: { size?: number; extra?: Uint8Array[]; pixels?: Uint8Array } = {}) {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, size)
  v.setUint32(4, size)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const raw = pixels ?? new Uint8Array(size * (1 + size * 4)).fill(0x80)
  if (!pixels) for (let r = 0; r < size; r++) raw[r * (1 + size * 4)] = 0
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  return Uint8Array.from(parts.flatMap((p) => [...p]))
}

describe('server icons', () => {
  it('keeps a good 64×64 PNG as it is', () => {
    const icon = png()
    expect(cleanIcon(icon)).toEqual(icon)
  })

  it('drops text and other extra chunks', () => {
    const text = chunk('tEXt', new TextEncoder().encode('Comment\0hello'))
    const cleaned = cleanIcon(png({ extra: [text] }))
    expect(cleaned).toEqual(png())
    expect(new TextDecoder().decode(cleaned)).not.toContain('hello')
  })

  it('refuses anything that is not a PNG', () => {
    expect(() => cleanIcon(new TextEncoder().encode('<svg/>'))).toThrow('must be a PNG')
    expect(() => cleanIcon(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toThrow('must be a PNG')
  })

  it('refuses the wrong size', () => {
    expect(() => cleanIcon(png({ size: 32 }))).toThrow('64×64 pixels, not 32×32')
  })

  it('refuses a damaged checksum', () => {
    const icon = png()
    icon[40] = icon[40]! ^ 0xff // inside IDAT
    expect(() => cleanIcon(icon)).toThrow('damaged')
  })

  it('refuses a file that is cut short', () => {
    const icon = png()
    expect(() => cleanIcon(icon.subarray(0, icon.length - 20))).toThrow()
  })

  it('refuses image data of the wrong size, or with bad row filters', () => {
    expect(() => cleanIcon(png({ pixels: new Uint8Array(100) }))).toThrow('image data is damaged')
    const bad = new Uint8Array(64 * (1 + 64 * 4)).fill(9)
    expect(() => cleanIcon(png({ pixels: bad }))).toThrow('image data is damaged')
  })

  it('refuses uploads over the limit', () => {
    expect(() => cleanIcon(new Uint8Array(MAX_ICON_BYTES + 1))).toThrow('too big')
  })
})
