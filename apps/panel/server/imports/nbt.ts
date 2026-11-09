/**
 * Just enough NBT to read level.dat: big-endian, gzip (or not), every tag type. Values come
 * back as plain JS (bigint for longs). Bounded so a hostile file can't exhaust memory.
 */
export type Nbt =
  number | bigint | string | Nbt[] | { [k: string]: Nbt } | Int8Array | Int32Array | BigInt64Array

const MAX_DEPTH = 64
const MAX_BYTES = 16 * 1024 * 1024

export class NbtError extends Error {
  override name = 'NbtError'
}

export function readNbt(input: Uint8Array): { [k: string]: Nbt } {
  let bytes = input
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = Bun.gunzipSync(bytes as Uint8Array<ArrayBuffer>)
  }
  if (bytes.length > MAX_BYTES) throw new NbtError('level.dat is far too big.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const utf8 = new TextDecoder()
  let at = 0
  const need = (n: number) => {
    if (n < 0 || at + n > bytes.length) throw new NbtError('level.dat is cut short.')
  }
  const u8 = () => (need(1), bytes[at++]!)
  const i16 = () => (need(2), (at += 2), view.getInt16(at - 2))
  const u16 = () => (need(2), (at += 2), view.getUint16(at - 2))
  const i32 = () => (need(4), (at += 4), view.getInt32(at - 4))
  const str = () => {
    const len = u16()
    need(len)
    at += len
    return utf8.decode(bytes.subarray(at - len, at))
  }
  const count = () => {
    const n = i32()
    if (n < 0 || n > MAX_BYTES) throw new NbtError('level.dat has a bad length.')
    return n
  }

  function value(type: number, depth: number): Nbt {
    if (depth > MAX_DEPTH) throw new NbtError('level.dat is nested too deeply.')
    switch (type) {
      case 1:
        return view.getInt8((need(1), at++))
      case 2:
        return i16()
      case 3:
        return i32()
      case 4:
        need(8)
        at += 8
        return view.getBigInt64(at - 8)
      case 5:
        need(4)
        at += 4
        return view.getFloat32(at - 4)
      case 6:
        need(8)
        at += 8
        return view.getFloat64(at - 8)
      case 7: {
        const n = count()
        need(n)
        at += n
        return new Int8Array(bytes.slice(at - n, at).buffer)
      }
      case 8:
        return str()
      case 9: {
        const inner = u8()
        const n = count()
        const out: Nbt[] = []
        for (let i = 0; i < n; i++) out.push(value(inner, depth + 1))
        return out
      }
      case 10: {
        const out: { [k: string]: Nbt } = {}
        for (;;) {
          const t = u8()
          if (t === 0) return out
          const name = str()
          out[name] = value(t, depth + 1)
        }
      }
      case 11: {
        const n = count()
        need(n * 4)
        const out = new Int32Array(n)
        for (let i = 0; i < n; i++) out[i] = i32()
        return out
      }
      case 12: {
        const n = count()
        need(n * 8)
        const out = new BigInt64Array(n)
        for (let i = 0; i < n; i++, at += 8) out[i] = view.getBigInt64(at)
        return out
      }
      default:
        throw new NbtError(`level.dat has an unknown tag type ${type}.`)
    }
  }

  if (u8() !== 10) throw new NbtError("level.dat doesn't start with a compound tag.")
  str()
  return value(10, 0) as { [k: string]: Nbt }
}

/** The Minecraft version a world was last saved with, e.g. "26.3", if it says. */
export function worldVersion(level: { [k: string]: Nbt }): {
  name: string | null
  dataVersion: number | null
} {
  const data = level.Data as { [k: string]: Nbt } | undefined
  const version = data?.Version as { [k: string]: Nbt } | undefined
  const name = typeof version?.Name === 'string' ? version.Name : null
  const dv = data?.DataVersion
  return { name, dataVersion: typeof dv === 'number' ? dv : null }
}
