/**
 * A player's face from their skin, as a small PNG Discord can show as an avatar: the 8×8 face
 * with the hat layer drawn over it, scaled up without smoothing so the pixels stay sharp.
 *
 * Skins from Mojang are 64×64 (or old 64×32) 8-bit RGBA PNGs, so that's what's read, plus
 * 8-bit RGB for good measure. Anything else is refused rather than guessed at.
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { crc32 } from '../icon'

export class HeadError extends Error {
  override name = 'HeadError'
}

/** The avatar's side in pixels: 8 skin pixels, each drawn 8×8. */
export const HEAD_SIZE = 64

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Skins are tiny; anything bigger isn't one. */
const MAX_SKIN_BYTES = 256 * 1024

interface Rgba {
  width: number
  height: number
  /** 4 bytes a pixel, rows top to bottom. */
  pixels: Uint8Array
}

/** Reads an 8-bit RGBA or RGB, non-interlaced PNG into RGBA pixels. */
export function decodePng(png: Uint8Array): Rgba {
  if (png.length > MAX_SKIN_BYTES) throw new HeadError('The skin is too big.')
  if (png.length < 8 || !SIGNATURE.every((b, i) => png[i] === b)) {
    throw new HeadError("The skin isn't a PNG.")
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  let at = 8
  while (at + 12 <= png.length) {
    const length = view.getUint32(at)
    if (at + 12 + length > png.length) throw new HeadError('The skin is cut short.')
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      if (length !== 13) throw new HeadError('The skin is damaged.')
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, colour, , , interlace] = data.subarray(8)
      if (depth !== 8 || interlace !== 0 || (colour !== 6 && colour !== 2)) {
        throw new HeadError('That kind of PNG isn’t supported.')
      }
      channels = colour === 6 ? 4 : 3
      if (width < 64 || width > 512 || height < 32 || height > 512) {
        throw new HeadError("That isn't the size of a skin.")
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    at += 12 + length
  }
  if (!channels || !idat.length) throw new HeadError('The skin is damaged.')

  const stride = width * channels
  const expected = (stride + 1) * height
  let raw: Uint8Array
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected })
  } catch {
    throw new HeadError('The skin is damaged.')
  }
  if (raw.length !== expected) throw new HeadError('The skin is damaged.')

  // Undo each row's filter (PNG spec, section 9).
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels]! : 0
      const b = y > 0 ? out[row - stride + x]! : 0
      const c = x >= channels && y > 0 ? out[row - stride + x - channels]! : 0
      const v = raw[src + x]!
      let pred: number
      switch (filter) {
        case 0:
          pred = 0
          break
        case 1:
          pred = a
          break
        case 2:
          pred = b
          break
        case 3:
          pred = (a + b) >> 1
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default:
          throw new HeadError('The skin is damaged.')
      }
      out[row + x] = (v + pred) & 0xff
    }
  }
  if (channels === 4) return { width, height, pixels: out }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i]!
    rgba[j + 1] = out[i + 1]!
    rgba[j + 2] = out[i + 2]!
    rgba[j + 3] = 255
  }
  return { width, height, pixels: rgba }
}

/** Writes RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ])
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** The face (8,8) with the hat (40,8) over it, as a HEAD_SIZE square PNG. */
export function renderHead(skin: Uint8Array): Uint8Array {
  const { width, pixels } = decodePng(skin)
  // HD skins are a whole multiple of 64 wide; scale the face's coordinates to match.
  const k = Math.max(1, Math.floor(width / 64))
  const px = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!] as const
  }
  const face = 8 * k
  const scale = HEAD_SIZE / face
  const out = new Uint8Array(HEAD_SIZE * HEAD_SIZE * 4)
  for (let fy = 0; fy < face; fy++) {
    for (let fx = 0; fx < face; fx++) {
      const [r, g, b] = px(face + fx, face + fy)
      const [hr, hg, hb, ha] = px(5 * face + fx, face + fy)
      // The face is opaque (Minecraft ignores its alpha); the hat layer blends over it.
      const t = ha / 255
      const colour = [
        Math.round(hr * t + r * (1 - t)),
        Math.round(hg * t + g * (1 - t)),
        Math.round(hb * t + b * (1 - t)),
        255,
      ]
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = Math.floor(fx * scale + dx)
          const y = Math.floor(fy * scale + dy)
          out.set(colour, (y * HEAD_SIZE + x) * 4)
        }
      }
    }
  }
  return encodePng(HEAD_SIZE, HEAD_SIZE, out)
}
