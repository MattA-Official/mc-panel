import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { createArchive, extractArchive, isExcluded, skippedFiles } from '../server/backups/archive'
import { describeSkipped, folderBytes } from '../server/backups/service'
import { toPrune, weekKey } from '../server/backups/retention'

describe('archive', () => {
  it('round-trips a server folder, skipping logs, keeping modes', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ft-arch-'))
    const src = join(base, 'src')
    mkdirSync(join(src, 'world', 'region'), { recursive: true })
    mkdirSync(join(src, 'logs'))
    writeFileSync(
      join(src, 'world', 'level.dat'),
      new Uint8Array(4096).map((_, i) => i % 251),
    )
    writeFileSync(join(src, 'world', 'region', 'r.0.0.mca'), 'x'.repeat(100_000))
    writeFileSync(join(src, 'odd name ünïcode.txt'), 'hi')
    writeFileSync(join(src, 'logs', 'latest.log'), 'noise')
    writeFileSync(join(src, 'run.sh'), '#!/bin/sh')
    chmodSync(join(src, 'run.sh'), 0o750)

    const dest = join(base, 'b.tar.zst')
    const { bytes } = await createArchive(src, dest)
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThan(20_000) // compressed
    expect(await readdir(base)).not.toContain('b.tar.zst.partial')

    const out = join(base, 'out')
    mkdirSync(out)
    await extractArchive(dest, out)
    expect(readFileSync(join(out, 'world', 'level.dat'))).toEqual(
      readFileSync(join(src, 'world', 'level.dat')),
    )
    expect(readFileSync(join(out, 'odd name ünïcode.txt'), 'utf8')).toBe('hi')
    expect((await readdir(out)).sort()).toEqual(['odd name ünïcode.txt', 'run.sh', 'world'])
    expect(statSync(join(out, 'run.sh')).mode & 0o100).toBeTruthy()
  })

  it('reports a corrupt archive and a missing folder', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ft-arch-'))
    writeFileSync(join(base, 'bad.tar.zst'), 'not zstd at all')
    await expect(extractArchive(join(base, 'bad.tar.zst'), base)).rejects.toThrow(
      "Couldn't read the backup",
    )
    await expect(createArchive(join(base, 'nope'), join(base, 'x.tar.zst'))).rejects.toThrow(
      'Archiving failed',
    )
    expect(await readdir(base)).toEqual(['bad.tar.zst'])
  })
})

describe('archive skips', () => {
  const tree = () => {
    const base = mkdtempSync(join(tmpdir(), 'ft-arch-'))
    const src = join(base, 'src')
    mkdirSync(join(src, 'config', 'spark', 'tmp'), { recursive: true })
    mkdirSync(join(src, 'world'))
    writeFileSync(join(src, 'config', 'spark', 'tmp', 'spark-1-profile-data.jfr.tmp'), 'x')
    writeFileSync(join(src, 'config', 'spark', 'config.json'), '{}')
    writeFileSync(join(src, 'world', 'level123.dat.tmp'), 'half')
    writeFileSync(join(src, 'world', 'level.dat'), 'whole')
    return { base, src }
  }

  it('leaves out spark scratch files and temp files', async () => {
    const { base, src } = tree()
    const dest = join(base, 'b.tar.zst')
    const { skipped } = await createArchive(src, dest)
    expect(skipped).toEqual([])
    const out = join(base, 'out')
    mkdirSync(out)
    await extractArchive(dest, out)
    expect(await readdir(join(out, 'config', 'spark'))).toEqual(['config.json'])
    expect(await readdir(join(out, 'world'))).toEqual(['level.dat'])
    expect(await folderBytes(src)).toBe('{}'.length + 'whole'.length)
  })

  it('knows what is excluded', () => {
    expect(isExcluded('logs')).toBe(true)
    expect(isExcluded('config/spark/tmp')).toBe(true)
    expect(isExcluded('world/level.dat_old.tmp')).toBe(true)
    expect(isExcluded('world/logs')).toBe(false)
    expect(isExcluded('config/spark')).toBe(false)
    expect(isExcluded('world/level.dat')).toBe(false)
  })

  // Root can read anything, so this only means something as an ordinary user (as in CI).
  it.skipIf(process.getuid?.() === 0)(
    'backs up the rest when a file cannot be read, and says which',
    async () => {
      const { base, src } = tree()
      writeFileSync(join(src, 'config', 'private.jfr'), 'secret')
      chmodSync(join(src, 'config', 'private.jfr'), 0o000)
      const dest = join(base, 'b.tar.zst')
      const { skipped } = await createArchive(src, dest)
      expect(skipped).toEqual(['config/private.jfr (Permission denied)'])
      const out = join(base, 'out')
      mkdirSync(out)
      await extractArchive(dest, out)
      expect(readFileSync(join(out, 'world', 'level.dat'), 'utf8')).toBe('whole')
    },
  )

  it("reads tar's warnings about files it left out", () => {
    const stderr = [
      'tar: ./config/spark/a.jfr: Warning: Cannot open: Permission denied',
      'tar: ./world/gone.mca: File removed before we read it',
      'tar: ./world/region: file changed as we read it',
      '',
    ].join('\n')
    expect(skippedFiles(stderr)).toEqual([
      'config/spark/a.jfr (Permission denied)',
      'world/gone.mca',
    ])
  })

  it('describes skipped files briefly', () => {
    expect(describeSkipped([])).toBe('')
    expect(describeSkipped(['a (Permission denied)'])).toBe(
      " Left out 1 file Flytower couldn't read: a (Permission denied).",
    )
    expect(describeSkipped(['a', 'b', 'c', 'd', 'e'])).toBe(
      " Left out 5 files Flytower couldn't read: a, b, c and 2 more.",
    )
  })
})

describe('retention', () => {
  const at = (iso: string, id: number) => ({ id, createdAt: new Date(iso) })

  it('knows ISO weeks across a year boundary', () => {
    expect(weekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01')
    expect(weekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53')
    expect(weekKey(new Date('2026-11-09T00:00:00Z'))).toBe('2026-W46')
  })

  it('keeps the newest N', () => {
    const list = [1, 2, 3, 4, 5].map((h) => at(`2026-11-09T0${h}:00:00Z`, h))
    const gone = toPrune(list, { keepLast: 2, keepDaily: 0, keepWeekly: 0 })
    expect(gone.map((b) => b.id)).toEqual([3, 2, 1])
  })

  it('keeps one a day and one a week on top', () => {
    // Every 6 hours for 21 days.
    const list = Array.from({ length: 84 }, (_, i) => ({
      id: i,
      createdAt: new Date(Date.UTC(2026, 10, 1) + i * 6 * 3_600_000),
    }))
    const gone = new Set(
      toPrune(list, { keepLast: 4, keepDaily: 7, keepWeekly: 4 }).map((b) => b.id),
    )
    const kept = list.filter((b) => !gone.has(b.id))
    // 4 newest (all on the last day) + 6 more days + earlier weeks' newest.
    expect(kept.slice(-4).map((b) => b.id)).toEqual([80, 81, 82, 83])
    const days = new Set(kept.map((b) => b.createdAt.toISOString().slice(0, 10)))
    expect(days.size).toBeGreaterThanOrEqual(7)
    const weeks = new Set(kept.map((b) => weekKey(b.createdAt)))
    expect(weeks.size).toBe(4)
    expect(kept.length).toBeLessThan(15)
  })

  it('keeps everything when the numbers are generous, nothing when all are zero', () => {
    const list = [at('2026-11-01T00:00:00Z', 1), at('2026-11-02T00:00:00Z', 2)]
    expect(toPrune(list, { keepLast: 10, keepDaily: 0, keepWeekly: 0 })).toEqual([])
    expect(toPrune(list, { keepLast: 0, keepDaily: 0, keepWeekly: 0 })).toHaveLength(2)
  })
})
