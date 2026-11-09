/** A tiny NBT writer for fixtures. */
export function levelDat(version: string | null, gzip = true) {
  const parts: number[] = []
  const u8 = (n: number) => parts.push(n & 0xff)
  const u16 = (n: number) => (u8(n >> 8), u8(n))
  const i32 = (n: number) => (u16(n >>> 16), u16(n & 0xffff))
  const str = (s: string) => {
    const b = new TextEncoder().encode(s)
    u16(b.length)
    parts.push(...b)
  }
  const tag = (t: number, name: string) => (u8(t), str(name))
  tag(10, '')
  tag(10, 'Data')
  tag(3, 'DataVersion')
  i32(4555)
  tag(8, 'LevelName')
  str('Survïval')
  tag(4, 'RandomSeed')
  i32(0)
  i32(42)
  tag(9, 'ServerBrands')
  u8(8)
  i32(2)
  str('vanilla')
  str('fabric')
  tag(11, 'Ints')
  i32(2)
  i32(-1)
  i32(7)
  if (version) {
    tag(10, 'Version')
    tag(8, 'Name')
    str(version)
    tag(1, 'Snapshot')
    u8(0)
    u8(0)
  }
  u8(0) // end Data
  u8(0) // end root
  const raw = new Uint8Array(parts)
  return gzip ? Bun.gzipSync(raw) : raw
}
