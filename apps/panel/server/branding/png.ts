/**
 * Cleaning uploaded PNG logos: check it really is a PNG of a sensible size, then rebuild it
 * from only the chunks that draw the picture. Text, EXIF, timestamps and anything private
 * or unknown are left behind.
 */
import { MAX_PNG_SIDE } from '../../shared/branding'

export class PngError extends Error {
  override name = 'PngError'
}

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Chunks that change how the image looks. Everything else is metadata. */
const KEEP = new Set([
  'IHDR',
  'PLTE',
  'tRNS',
  'IDAT',
  'IEND',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface PngInfo {
  width: number
  height: number
}

/** Checks and rebuilds a PNG. Throws PngError with a reason a person can act on. */
export function cleanPng(input: Uint8Array): { bytes: Uint8Array; info: PngInfo } {
  if (input.length < 8 || !SIGNATURE.every((b, i) => input[i] === b)) {
    throw new PngError("That isn't a PNG.")
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const kept: Uint8Array[] = [SIGNATURE]
  let info: PngInfo | null = null
  let ended = false
  let sawData = false
  let at = 8
  while (at < input.length) {
    if (at + 12 > input.length) throw new PngError('The PNG is cut short.')
    const length = view.getUint32(at)
    const end = at + 12 + length
    if (end > input.length) throw new PngError('The PNG is cut short.')
    const type = String.fromCharCode(...input.subarray(at + 4, at + 8))
    if (!/^[A-Za-z]{4}$/.test(type)) throw new PngError('The PNG is damaged.')
    const crc = view.getUint32(at + 8 + length)
    if (crc32(input.subarray(at + 4, at + 8 + length)) !== crc) {
      throw new PngError('The PNG is damaged (a checksum is wrong).')
    }
    if (!info) {
      if (type !== 'IHDR' || length !== 13) throw new PngError('The PNG is damaged.')
      info = { width: view.getUint32(at + 8), height: view.getUint32(at + 12) }
      if (!info.width || !info.height) throw new PngError('The PNG is empty.')
      if (info.width > MAX_PNG_SIDE || info.height > MAX_PNG_SIDE) {
        throw new PngError(
          `The PNG is ${info.width}×${info.height}. Make it ${MAX_PNG_SIDE} pixels or less on each side.`,
        )
      }
    }
    if (type === 'IDAT') sawData = true
    // Animated PNGs (acTL, fcTL, fdAT) are dropped here, leaving the first frame.
    if (KEEP.has(type)) kept.push(input.subarray(at, end))
    at = end
    if (type === 'IEND') {
      ended = true
      break
    }
  }
  if (!info || !sawData || !ended) throw new PngError('The PNG is cut short.')
  const total = kept.reduce((n, c) => n + c.length, 0)
  const bytes = new Uint8Array(total)
  let o = 0
  for (const c of kept) {
    bytes.set(c, o)
    o += c.length
  }
  return { bytes, info }
}
