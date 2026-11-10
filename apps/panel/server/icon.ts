/**
 * Server icons: the 64×64 `server-icon.png` Minecraft shows in the multiplayer list. The
 * browser crops and scales the picture; here the upload is checked as a PNG all the way
 * through (every chunk's checksum, and image data that inflates to exactly the size the
 * header promises) and written back with only the chunks the image needs, so text, metadata
 * and anything else that came with the upload is dropped.
 */
import { inflateSync } from 'node:zlib'

export const ICON_FILE = 'server-icon.png'
export const ICON_SIZE = 64
/** A 64×64 PNG is a few KB; this leaves plenty of room. */
export const MAX_ICON_BYTES = 64 * 1024

export class IconError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IconError'
  }
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Chunks that change how the image looks; everything else is left out. */
const KEPT = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
/** Channels for each PNG colour type, and the bit depths it allows. */
const COLOUR_TYPES: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
}

interface Chunk {
  type: string
  data: Uint8Array
  /** The whole chunk as it was: length, type, data and checksum. */
  raw: Uint8Array
}

/** Checks an uploaded icon and returns a clean copy to write, or throws an IconError. */
export function cleanIcon(input: Uint8Array): Uint8Array {
  if (input.length > MAX_ICON_BYTES) throw new IconError('The icon is too big.')
  if (input.length < SIGNATURE.length || !SIGNATURE.every((b, i) => input[i] === b)) {
    throw new IconError('The icon must be a PNG.')
  }
  const chunks = readChunks(input)
  const header = chunks[0]
  if (header?.type !== 'IHDR' || header.data.length !== 13) {
    throw new IconError('The PNG has no header.')
  }
  const view = new DataView(header.data.buffer, header.data.byteOffset, 13)
  const width = view.getUint32(0)
  const height = view.getUint32(4)
  const [depth, colourType, compression, filter, interlace] = header.data.subarray(8)
  if (width !== ICON_SIZE || height !== ICON_SIZE) {
    throw new IconError(`The icon must be ${ICON_SIZE}×${ICON_SIZE} pixels, not ${width}×${height}.`)
  }
  const kind = COLOUR_TYPES[colourType!]
  if (!kind || !kind.depths.includes(depth!) || compression || filter || interlace) {
    throw new IconError('That kind of PNG isn’t supported.')
  }
  if (chunks.at(-1)?.type !== 'IEND') throw new IconError('The PNG is cut short.')
  if (colourType === 3 && !chunks.some((c) => c.type === 'PLTE')) {
    throw new IconError('The PNG has no palette.')
  }

  const idat = chunks.filter((c) => c.type === 'IDAT')
  if (!idat.length) throw new IconError('The PNG has no image data.')
  const rowBytes = 1 + Math.ceil((width * kind.channels * depth!) / 8)
  const expected = rowBytes * height
  let pixels: Uint8Array
  try {
    pixels = inflateSync(concat(idat.map((c) => c.data)), { maxOutputLength: expected + 1 })
  } catch {
    throw new IconError('The PNG’s image data is damaged.')
  }
  if (pixels.length !== expected) throw new IconError('The PNG’s image data is damaged.')
  for (let row = 0; row < height; row++) {
    if (pixels[row * rowBytes]! > 4) throw new IconError('The PNG’s image data is damaged.')
  }

  return concat([SIGNATURE, ...chunks.filter((c) => KEPT.has(c.type)).map((c) => c.raw)])
}

function readChunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Chunk[] = []
  let at = SIGNATURE.length
  while (at < png.length) {
    if (at + 12 > png.length) throw new IconError('The PNG is cut short.')
    const length = view.getUint32(at)
    const end = at + 12 + length
    if (end > png.length) throw new IconError('The PNG is cut short.')
    const typeBytes = png.subarray(at + 4, at + 8)
    const type = String.fromCharCode(...typeBytes)
    if (!/^[A-Za-z]{4}$/.test(type)) throw new IconError('The PNG is damaged.')
    const data = png.subarray(at + 8, at + 8 + length)
    if (crc32(png.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length)) {
      throw new IconError('The PNG is damaged.')
    }
    chunks.push({ type, data, raw: png.subarray(at, end) })
    at = end
    if (type === 'IEND') break
  }
  return chunks
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
