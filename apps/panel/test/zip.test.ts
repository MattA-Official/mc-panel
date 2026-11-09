import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { entriesFor, writeZip } from '../server/zip'

function tree() {
  const base = mkdtempSync(join(tmpdir(), 'ft-zip-'))
  const world = join(base, 'world')
  mkdirSync(join(world, 'region'), { recursive: true })
  mkdirSync(join(world, 'DIM-1', 'region'), { recursive: true })
  mkdirSync(join(world, 'empty'))
  writeFileSync(
    join(world, 'level.dat'),
    new Uint8Array(5000).map((_, i) => (i * 7) % 256),
  )
  writeFileSync(join(world, 'region', 'r.0.0.mca'), 'abc'.repeat(200_000))
  writeFileSync(
    join(world, 'DIM-1', 'region', 'r.-1.0.mca'),
    crypto.getRandomValues(new Uint8Array(65536)),
  )
  writeFileSync(join(world, 'naïve name.txt'), '')
  return { base, world }
}

// Checked by two independent readers: Info-ZIP's unzip and Python's zipfile.
async function verify(zip: string, base: string) {
  const t = Bun.spawnSync(['unzip', '-tq', zip])
  expect(t.stdout.toString() + t.stderr.toString()).toContain('No errors detected')
  const out = join(base, 'out')
  const py = Bun.spawnSync([
    'python3',
    '-I',
    '-c',
    'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2]); print(len(z.namelist()))',
    zip,
    out,
  ])
  expect(py.stderr.toString()).toBe('')
  return { out, names: Number(py.stdout.toString().trim()) }
}

describe('writeZip', () => {
  for (const forceZip64 of [false, true]) {
    it(`writes a zip that unzip and Python agree on${forceZip64 ? ' (zip64)' : ''}`, async () => {
      const { base, world } = tree()
      const entries = await entriesFor(world, 'My World')
      const zip = join(base, 'w.zip')
      let seen = 0
      const { bytes, files } = await writeZip(entries, zip, {
        forceZip64,
        onProgress: (n) => (seen = n),
      })
      expect(files).toBe(4)
      expect(seen).toBe(5000 + 600_000 + 65536)
      expect(bytes).toBe(Bun.file(zip).size)
      expect(bytes).toBeLessThan(120_000) // the repetitive region compressed
      const { out, names } = await verify(zip, base)
      expect(names).toBe(entries.length)
      for (const f of [
        'level.dat',
        'region/r.0.0.mca',
        'DIM-1/region/r.-1.0.mca',
        'naïve name.txt',
      ]) {
        expect(readFileSync(join(out, 'My World', f))).toEqual(readFileSync(join(world, f)))
      }
    })
  }

  it('lists folders, including empty ones, before their files', async () => {
    const { world } = tree()
    const names = (await entriesFor(world, 'w')).map((e) => e.name)
    expect(names[0]).toBe('w/')
    expect(names).toContain('w/empty/')
    expect(names.indexOf('w/region/')).toBeLessThan(names.indexOf('w/region/r.0.0.mca'))
  })
})
