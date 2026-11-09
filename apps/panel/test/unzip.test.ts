import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { listZip, safeName, unzip } from '../server/unzip'
import { entriesFor, writeZip } from '../server/zip'

const tmp = () => mkdtempSync(join(tmpdir(), 'ft-unzip-'))

function world(base: string) {
  const w = join(base, 'src')
  mkdirSync(join(w, 'region'), { recursive: true })
  writeFileSync(join(w, 'level.dat'), crypto.getRandomValues(new Uint8Array(3000)))
  writeFileSync(join(w, 'region', 'r.0.0.mca'), 'z'.repeat(300_000))
  writeFileSync(join(w, 'ünï.txt'), 'hi')
  return w
}

/** A zip made by Python, for names and links our writer would never produce. */
function pyZip(path: string, script: string) {
  const r = Bun.spawnSync([
    'python3',
    '-I',
    '-c',
    `import zipfile, sys\nz = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)\n${script}\nz.close()`,
    path,
  ])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

describe('unzip', () => {
  for (const forceZip64 of [false, true]) {
    it(`round-trips our own zips${forceZip64 ? ' (zip64)' : ''}`, async () => {
      const base = tmp()
      const src = world(base)
      const zip = join(base, 'w.zip')
      await writeZip(await entriesFor(src, 'World'), zip, { forceZip64 })
      const out = join(base, 'out')
      const r = await unzip(zip, out, { maxBytes: 1e9 })
      expect(r).toEqual({ files: 3, bytes: 303_002, skipped: [] })
      for (const f of ['level.dat', 'region/r.0.0.mca', 'ünï.txt']) {
        expect(readFileSync(join(out, 'World', f))).toEqual(readFileSync(join(src, f)))
      }
    })
  }

  it('reads zips made by Python, skipping unsafe names and links', async () => {
    const base = tmp()
    const zip = join(base, 'evil.zip')
    pyZip(
      zip,
      [
        "z.writestr('ok/level.dat', b'fine')",
        "z.writestr('../escape.txt', b'no')",
        "z.writestr('/etc/passwd', b'no')",
        "z.writestr('a/../../b.txt', b'no')",
        "i = zipfile.ZipInfo('link'); i.create_system = 3; i.external_attr = (0o120777 << 16); z.writestr(i, '/etc/passwd')",
        "z.writestr('stored.txt', b'plain', compress_type=zipfile.ZIP_STORED)",
      ].join('\n'),
    )
    const out = join(base, 'out')
    const r = await unzip(zip, out, { maxBytes: 1e9 })
    expect(r.files).toBe(2)
    expect(r.skipped.sort()).toEqual(['../escape.txt', '/etc/passwd', 'a/../../b.txt', 'link'])
    expect((await readdir(out)).sort()).toEqual(['ok', 'stored.txt'])
    expect(await readdir(base)).not.toContain('escape.txt')
  })

  it('refuses archives bigger than the space allowed, and entries that lie about size', async () => {
    const base = tmp()
    const src = world(base)
    const zip = join(base, 'w.zip')
    await writeZip(await entriesFor(src, 'W'), zip)
    await expect(unzip(zip, join(base, 'a'), { maxBytes: 1000 })).rejects.toThrow('unpacks to more')

    // Shrink the declared size of the big file in the central directory: a tiny zip bomb.
    const bytes = readFileSync(zip)
    const items = await listZip(zip)
    const big = items.find((i) => i.name.endsWith('r.0.0.mca'))!
    const at = bytes.lastIndexOf(Buffer.from('W/region/r.0.0.mca')) - 46
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50)
    bytes.writeUInt32LE(1000, at + 24)
    writeFileSync(zip, bytes)
    expect(big.usize).toBe(300_000)
    await expect(unzip(zip, join(base, 'b'), { maxBytes: 1e9 })).rejects.toThrow(
      'bigger than it claims',
    )
  })

  it('says when a file is not a zip', async () => {
    const base = tmp()
    writeFileSync(join(base, 'x.zip'), 'nope')
    await expect(listZip(join(base, 'x.zip'))).rejects.toThrow("isn't a zip")
  })

  it('cleans names', () => {
    expect(safeName('a\\b/./c')).toBe('a/b/c')
    expect(safeName('C:/x')).toBeNull()
    expect(safeName('a/../b')).toBeNull()
    expect(safeName('./')).toBeNull()
  })
})
