import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { prepareFolders } from '../src/folders'
import { fakeContext, fakeExec } from './fakes'

function machine() {
  const root = mkdtempSync(join(tmpdir(), 'ft-folders-'))
  const data = join(root, 'data')
  const paths = {
    servers: join(root, 'srv'),
    runtimes: join(root, 'runtimes'),
    archive: join(root, 'archive'),
    config: join(root, 'etc'),
    systemd: join(root, 'systemd'),
    state: join(root, 'agent-state'),
    panelData: data,
  }
  mkdirSync(join(data, 'agent'), { recursive: true })
  mkdirSync(join(data, 'archive'), { recursive: true })
  return { root, data, paths }
}

describe('prepareFolders', () => {
  it('makes a root-only state folder and moves the old state into it', async () => {
    const { data, paths } = machine()
    writeFileSync(join(data, 'agent', 'ssh.json'), '{"closesAt":"2030-01-01T00:00:00.000Z"}')
    writeFileSync(join(data, 'agent', 'update.json'), 'not json')
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    await prepareFolders(ctx)
    expect(statSync(paths.state).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(paths.state, 'ssh.json'), 'utf8')).toContain('2030')
    expect(existsSync(join(paths.state, 'update.json'))).toBe(false)
    expect(existsSync(join(data, 'agent'))).toBe(false)
  })

  it('never reads through a link left in the old state folder', async () => {
    const { root, data, paths } = machine()
    writeFileSync(join(root, 'secret'), '{"secret":true}')
    symlinkSync(join(root, 'secret'), join(data, 'agent', 'update.json'))
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    await prepareFolders(ctx)
    expect(existsSync(join(paths.state, 'update.json'))).toBe(false)
    expect(readFileSync(join(root, 'secret'), 'utf8')).toBe('{"secret":true}')
  })

  it('moves archives of deleted servers across, but not links or other files', async () => {
    const { root, data, paths } = machine()
    const name = 'survival-2026-11-01T10-00-00-000Z.tar.gz'
    writeFileSync(join(data, 'archive', name), 'tarball')
    writeFileSync(join(root, 'secret'), 'root only')
    symlinkSync(
      join(root, 'secret'),
      join(data, 'archive', 'other-2026-11-01T10-00-00-000Z.tar.gz'),
    )
    writeFileSync(join(data, 'archive', 'notes.txt'), 'hi')
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    await prepareFolders(ctx)
    expect(readFileSync(join(paths.archive, name), 'utf8')).toBe('tarball')
    expect(statSync(join(paths.archive, name)).mode & 0o777).toBe(0o640)
    expect(statSync(paths.archive).mode & 0o777).toBe(0o750)
    expect(existsSync(join(paths.archive, 'other-2026-11-01T10-00-00-000Z.tar.gz'))).toBe(false)
    expect(lstatSync(join(data, 'archive', 'notes.txt')).isFile()).toBe(true)
    const cmds = calls.map((c) => [c.file, ...c.args].join(' '))
    expect(cmds).toContain(`chgrp --no-dereference flytower ${paths.archive}`)
    expect(cmds).toContain(`chown --no-dereference 0:flytower ${join(paths.archive, name)}`)
  })

  it('refuses a state folder that is a link', async () => {
    const { root, paths } = machine()
    mkdirSync(join(root, 'elsewhere'))
    symlinkSync(join(root, 'elsewhere'), paths.state)
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    await expect(prepareFolders(ctx)).rejects.toThrow("isn't a folder owned by")
  })
})
