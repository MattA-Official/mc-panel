import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { listLogs, MAX_LINES, readLog } from '../server/logs'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ft-logs-'))
  mkdirSync(join(root, 'logs'))
  writeFileSync(
    join(root, 'logs', 'latest.log'),
    "[12:00:00] [Server thread/INFO]: Done (3.1s)!\n[12:00:05] [Server thread/WARN]: Can't keep up!\n",
  )
  writeFileSync(
    join(root, 'logs', '2026-11-07-1.log.gz'),
    Bun.gzipSync(new TextEncoder().encode('old line one\nOld line two\n')),
  )
  writeFileSync(
    join(root, 'logs', '2026-11-08-1.log.gz'),
    Bun.gzipSync(new TextEncoder().encode('newer\n')),
  )
  writeFileSync(join(root, 'logs', 'notes.txt'), 'not a log')
  writeFileSync(join(root, 'logs', 'broken.log.gz'), 'not gzip')
  utimesSync(join(root, 'logs', '2026-11-07-1.log.gz'), 1, 1)
  utimesSync(join(root, 'logs', '2026-11-08-1.log.gz'), 2, 2)
})

describe('listLogs', () => {
  it('lists logs with the live one first, then newest', async () => {
    const names = (await listLogs(root)).map((l) => [l.name, l.live])
    expect(names[0]).toEqual(['latest.log', true])
    expect(names.map((n) => n[0])).not.toContain('notes.txt')
    expect(names.slice(-2).map((n) => n[0])).toEqual(['2026-11-08-1.log.gz', '2026-11-07-1.log.gz'])
  })

  it('is empty when there is no logs folder yet', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'ft-logs-'))
    expect(await listLogs(bare)).toEqual([])
  })
})

describe('readLog', () => {
  it('reads plain and gzipped logs', async () => {
    expect((await readLog(root, 'latest.log')).lines).toHaveLength(2)
    expect(await readLog(root, '2026-11-07-1.log.gz')).toEqual({
      lines: ['old line one', 'Old line two'],
      total: 2,
      matched: 2,
      truncated: false,
    })
  })

  it('searches without caring about case', async () => {
    const v = await readLog(root, '2026-11-07-1.log.gz', 'OLD LINE T')
    expect(v).toMatchObject({ lines: ['Old line two'], total: 2, matched: 1 })
  })

  it('keeps only the last lines of a huge log', async () => {
    const many = Array.from({ length: MAX_LINES + 10 }, (_, i) => `line ${i}`).join('\n')
    writeFileSync(join(root, 'logs', 'big.log'), many)
    const v = await readLog(root, 'big.log')
    expect(v.truncated).toBe(true)
    expect(v.lines).toHaveLength(MAX_LINES)
    expect(v.lines.at(-1)).toBe(`line ${MAX_LINES + 9}`)
  })

  it('refuses names that are not logs, missing logs, bad gzip and symlinks', async () => {
    await expect(readLog(root, '../server.properties')).rejects.toThrow("isn't a log")
    await expect(readLog(root, 'notes.txt')).rejects.toThrow("isn't a log")
    await expect(readLog(root, 'nope.log')).rejects.toThrow('No such log')
    await expect(readLog(root, 'broken.log.gz')).rejects.toThrow("isn't valid gzip")
    writeFileSync(join(root, 'secret.log'), 'x')
    symlinkSync(join(root, 'secret.log'), join(root, 'logs', 'link.log'))
    await expect(readLog(root, 'link.log')).rejects.toThrow('not followed')
  })
})
