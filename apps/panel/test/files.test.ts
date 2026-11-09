import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  FileError,
  list,
  makeDir,
  move,
  readText,
  remove,
  resolveInside,
  writeAtomic,
} from '../server/files'

let root: string
let outside: string
beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'ft-files-'))
  root = join(base, 'server')
  outside = join(base, 'secret')
  mkdirSync(join(root, 'world', 'region'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(outside, 'passwd'), 'root:x:0:0')
  writeFileSync(join(root, 'server.properties'), 'motd=hi\n')
  writeFileSync(join(root, 'server.jar'), new Uint8Array([0x50, 0x4b, 0, 1]))
  symlinkSync(outside, join(root, 'escape'))
  symlinkSync(join(outside, 'passwd'), join(root, 'passwd-link'))
})

const refused = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e) => e,
  )
  expect(err).toBeInstanceOf(FileError)
  return err as FileError
}

describe('resolveInside', () => {
  it('keeps paths inside the folder', async () => {
    expect(await resolveInside(root, '/world/region')).toEndWith('/server/world/region')
    expect(await resolveInside(root, 'world/../server.properties')).toEndWith(
      '/server/server.properties',
    )
    await refused(resolveInside(root, '../secret/passwd'))
    await refused(resolveInside(root, '/../../etc/passwd'))
    await refused(resolveInside(root, 'world/../../secret'))
  })

  it('never follows symlinks', async () => {
    await refused(resolveInside(root, 'escape/passwd'))
    await refused(resolveInside(root, 'passwd-link'))
    await refused(readText(root, 'passwd-link'))
    await refused(writeAtomic(root, 'escape/new.txt', 'x'))
    await refused(list(root, 'escape'))
  })
})

describe('file operations', () => {
  it('lists folders first and marks links', async () => {
    const entries = await list(root, '/')
    expect(entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      'dir:world',
      'link:escape',
      'link:passwd-link',
      'file:server.jar',
      'file:server.properties',
    ])
  })

  it('reads text and refuses binary', async () => {
    expect(await readText(root, 'server.properties')).toBe('motd=hi\n')
    expect((await refused(readText(root, 'server.jar'))).status).toBe(415)
  })

  it('writes atomically and group-writable', async () => {
    await writeAtomic(root, 'ops.json', '[]')
    expect(await readFile(join(root, 'ops.json'), 'utf8')).toBe('[]')
    expect((await stat(join(root, 'ops.json'))).mode & 0o777).toBe(0o660)
    await refused(writeAtomic(root, 'missing/dir/file.txt', 'x'))
    await refused(writeAtomic(root, 'world', 'x'))
  })

  it('makes, moves and deletes, but never the root', async () => {
    await makeDir(root, 'mods')
    expect((await stat(join(root, 'mods'))).mode & 0o7777).toBe(0o2770)
    await move(root, 'server.properties', 'mods/server.properties')
    await refused(move(root, 'world', 'world/region/inner'))
    await refused(move(root, '/', 'x'))
    await remove(root, 'world')
    expect((await list(root, '/')).map((e) => e.name)).not.toContain('world')
    await refused(remove(root, '/'))
    await refused(remove(root, '..'))
  })
})
