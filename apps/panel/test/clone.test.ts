import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { cloneSource, copyServerFolder } from '../server/clone'

function source() {
  const src = mkdtempSync(join(tmpdir(), 'ft-src-'))
  for (const d of ['mods', 'logs', 'world/region', 'world/datapacks', '.flytower-staging']) {
    mkdirSync(join(src, d), { recursive: true })
  }
  writeFileSync(join(src, 'server.jar'), 'jar')
  writeFileSync(join(src, 'server.properties'), 'motd=Hi\n')
  writeFileSync(join(src, 'flytower.lock.json'), '{}')
  writeFileSync(join(src, 'mods', 'lithium.jar'), 'mod')
  writeFileSync(join(src, 'logs', 'latest.log'), 'log')
  writeFileSync(join(src, 'world', 'region', 'r.0.0.mca'), 'chunks')
  writeFileSync(join(src, 'world', 'datapacks', 'graves.zip'), 'pack')
  return src
}

describe('clone copy', () => {
  it('copies the server with its world, skipping jars, logs and staging', async () => {
    const src = source()
    const dest = join(mkdtempSync(join(tmpdir(), 'ft-dest-')), 'copy')
    await copyServerFolder(src, dest, { withWorld: true, levelName: 'world' })
    expect(readFileSync(join(dest, 'mods', 'lithium.jar'), 'utf8')).toBe('mod')
    expect(existsSync(join(dest, 'world', 'region', 'r.0.0.mca'))).toBe(true)
    expect(existsSync(join(dest, 'flytower.lock.json'))).toBe(true)
    for (const gone of ['server.jar', 'logs', '.flytower-staging']) {
      expect(existsSync(join(dest, gone))).toBe(false)
    }
  })

  it('without the world, keeps only its datapacks', async () => {
    const src = source()
    const dest = join(mkdtempSync(join(tmpdir(), 'ft-dest-')), 'copy')
    await copyServerFolder(src, dest, { withWorld: false, levelName: 'world' })
    expect(existsSync(join(dest, 'world', 'region'))).toBe(false)
    expect(readFileSync(join(dest, 'world', 'datapacks', 'graves.zip'), 'utf8')).toBe('pack')
  })

  it('pauses saving and holds the lock while copying, and discards the copy', async () => {
    const src = source()
    const staging = join(mkdtempSync(join(tmpdir(), 'ft-stage-')), 'clone-1')
    const events: string[] = []
    const prepared = cloneSource(
      {
        serverDir: () => src,
        readProperties: async () => ({}),
        backups: {
          lock: () => (events.push('lock'), () => void events.push('release')),
          ensureSpace: async () => void events.push('space'),
          withSavesPaused: async (_s, _r, fn) => {
            events.push('paused')
            return fn()
          },
        },
      },
      'survival',
      staging,
      { withWorld: true },
    )
    expect(await prepared.prepare()).toEqual({ root: staging, kind: 'server' })
    expect(events).toEqual(['lock', 'space', 'paused', 'release'])
    expect(existsSync(join(staging, 'world', 'region'))).toBe(true)
    await prepared.discard()
    expect(existsSync(staging)).toBe(false)
  })
})
