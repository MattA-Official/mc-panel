/**
 * Server folders are writable by the server process, so the panel must not trust what it
 * finds there: links where it writes temporary files, odd lockfile paths, odd level-names.
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { FileError, readNoFollow, replaceFile } from '../server/files'
import { LOCK_FILE, isContentPath, readLock, writeLock, LockError } from '../server/spec/lock'
import { ServerSpec, isSafeLevelName } from '../shared/spec'

let root: string
let outside: string
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'ft-trust-'))
  root = join(base, 'server')
  outside = join(base, 'panel-secret')
  mkdirSync(root)
  writeFileSync(outside, 'keep me')
})

describe('replaceFile', () => {
  it('never writes through a link planted at an old fixed temporary name', async () => {
    const path = join(root, 'server.properties')
    for (const name of ['server.properties.flytower', 'server.properties.tmp']) {
      symlinkSync(outside, join(root, name))
    }
    await replaceFile(path, 'motd=hi\n')
    expect(readFileSync(outside, 'utf8')).toBe('keep me')
    expect(readFileSync(path, 'utf8')).toBe('motd=hi\n')
  })

  it('replaces a link at the target instead of writing through it', async () => {
    const path = join(root, 'ops.json')
    symlinkSync(outside, path)
    await replaceFile(path, '[]\n')
    expect(readFileSync(outside, 'utf8')).toBe('keep me')
    expect(lstatSync(path).isFile()).toBe(true)
  })

  it('leaves the file group-writable and no temporary files behind', async () => {
    const path = join(root, 'whitelist.json')
    await replaceFile(path, '[]\n')
    expect(lstatSync(path).mode & 0o777).toBe(0o660)
    await replaceFile(path, new Response('[1]\n'))
    expect(readFileSync(path, 'utf8')).toBe('[1]\n')
    expect(readdirSync(root)).toEqual(['whitelist.json'])
  })
})

describe('readNoFollow', () => {
  it('reads files, gives null when missing, and refuses links', async () => {
    writeFileSync(join(root, 'a.json'), '{}')
    symlinkSync(outside, join(root, 'b.json'))
    expect(await readNoFollow(join(root, 'a.json'))).toBe('{}')
    expect(await readNoFollow(join(root, 'nope.json'))).toBeNull()
    await expect(readNoFollow(join(root, 'b.json'))).rejects.toBeInstanceOf(FileError)
  })
})

describe('lockfile paths', () => {
  it('accepts files directly in the content folders', () => {
    for (const ok of [
      'mods/lithium-0.14.jar',
      'plugins/Essentials X (2).jar',
      'world/datapacks/vt-graves.zip',
      'My World/datapacks/x',
    ]) {
      expect(isContentPath(ok)).toBe(true)
    }
  })

  it('refuses anything that could leave them', () => {
    for (const bad of [
      '../b/world',
      'mods/../../b/world',
      'mods/sub/x.jar',
      'mods/',
      'mods/.hidden.jar',
      'mods/..',
      'config/x.jar',
      '/etc/passwd',
      '../x/datapacks/a.zip',
      'world/../../x/datapacks/a.zip',
      'mods\\..\\x.jar',
      'x.jar',
    ]) {
      expect(isContentPath(bad)).toBe(false)
    }
  })

  const item = (path: string) => ({
    source: 'modrinth',
    projectId: 'p',
    slug: 'old',
    title: 'Old helper',
    versionId: 'v',
    versionNumber: '1',
    kind: 'mod',
    path,
    url: 'https://cdn.modrinth.com/x.jar',
    sha256: '',
    size: null,
    requiredBy: [],
  })

  it('refuses a lockfile with a path outside the content folders', async () => {
    const lock = { version: 1, updatedAt: new Date(0).toISOString(), content: [item('../b/world')] }
    writeFileSync(join(root, LOCK_FILE), JSON.stringify(lock))
    await expect(readLock(root)).rejects.toBeInstanceOf(LockError)
  })

  it('refuses a lockfile that is a link', async () => {
    symlinkSync(outside, join(root, LOCK_FILE))
    await expect(readLock(root)).rejects.toBeInstanceOf(LockError)
  })

  it('round-trips a good lockfile', async () => {
    const lock = {
      version: 1 as const,
      updatedAt: new Date(0).toISOString(),
      content: [item('mods/old.jar') as never],
    }
    await writeLock(root, lock)
    expect((await readLock(root)).content[0]!.path).toBe('mods/old.jar')
  })
})

describe('level-name', () => {
  it('allows plain folder names only', () => {
    for (const ok of ['world', 'My World', 'survival-2', 'w.v2', 'world_nether']) {
      expect(isSafeLevelName(ok)).toBe(true)
    }
    for (const bad of ['../b/world', 'a/b', '/srv/x', '..', 'a..b', '.hidden', '', ' x']) {
      expect(isSafeLevelName(bad)).toBe(false)
    }
  })

  it('is checked in a spec', () => {
    const base = { name: 'ab', loader: { type: 'vanilla', minecraft: '26.3' } }
    const bad = ServerSpec.safeParse({ ...base, properties: { 'level-name': '../b/world' } })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues[0]!.path).toEqual(['properties', 'level-name'])
    expect(
      ServerSpec.safeParse({ ...base, properties: { 'level-name': 'survival' } }).success,
    ).toBe(true)
  })
})
