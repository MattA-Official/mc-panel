import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { dispatch, handlers } from '../src/index.ts'
import { refreshTemplate, ufwRuleNumbers } from '../src/handlers/server.ts'
import { templateUnit } from '../src/units.ts'
import type { AgentContext } from '../src/context.ts'
import { fakeContext, fakeExec } from './fakes.ts'

let root: string
let paths: AgentContext['paths']

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'flytower-srv-'))
  paths = {
    servers: join(root, 'servers'),
    runtimes: join(root, 'runtimes'),
    archive: join(root, 'archive'),
    config: join(root, 'etc'),
    systemd: join(root, 'systemd'),
    state: join(root, 'state'),
  }
  mkdirSync(join(paths.runtimes, 'temurin-25', 'bin'), { recursive: true })
  writeFileSync(join(paths.runtimes, 'temurin-25', 'bin', 'java'), '')
})

const create = (params: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'c',
    verb: 'server.create',
    params: { name: 'survival', port: 25565, memoryMb: 6144, javaMajor: 25, ...params },
  })

describe('server.create', () => {
  it('creates user, folder, env, limits, unit and firewall rule', async () => {
    const { exec, calls } = fakeExec({ 'id -u mc-survival': { code: 1 } })
    const { ctx } = fakeContext(exec, undefined, paths)
    const res = await dispatch(create(), handlers, ctx)
    expect(res).toMatchObject({ ok: true, result: { user: 'mc-survival' } })

    const cmds = calls.map((c) => [c.file, ...c.args].join(' '))
    expect(cmds).toContain(
      `useradd --system --home-dir ${paths.servers}/survival --no-create-home --shell /usr/sbin/nologin --user-group mc-survival`,
    )
    expect(cmds).toContain(`chown mc-survival:flytower ${paths.servers}/survival`)
    expect(cmds).toContain(`chmod 2770 ${paths.servers}/survival`)
    expect(cmds).toContain('ufw allow 25565/tcp comment flytower server survival')
    expect(cmds.indexOf('systemctl daemon-reload')).toBeLessThan(
      cmds.indexOf('systemctl enable flytower-mc@survival.service'),
    )

    const env = readFileSync(join(paths.config, 'servers', 'survival.env'), 'utf8')
    expect(env).toContain(`JAVA_HOME=${paths.runtimes}/temurin-25`)
    expect(env).toContain('HEAP_MB=6144')
    const limits = readFileSync(
      join(paths.systemd, 'flytower-mc@survival.service.d', 'limits.conf'),
      'utf8',
    )
    expect(limits).toContain('MemoryMax=7168M')
    const unit = readFileSync(join(paths.systemd, 'flytower-mc@.service'), 'utf8')
    expect(unit).toContain('User=mc-%i')
    expect(unit).toContain('ProtectSystem=strict')
  })

  it('refuses when the server already exists', async () => {
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    const res = await dispatch(create(), handlers, ctx)
    expect(res).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(calls.some((c) => c.file === 'useradd')).toBe(false)
  })

  it('refuses when the Java runtime is missing', async () => {
    const { exec } = fakeExec({ 'id -u': { code: 1 } })
    const { ctx } = fakeContext(exec, undefined, paths)
    const res = await dispatch(create({ javaMajor: 21 }), handlers, ctx)
    expect(res).toMatchObject({ ok: false, error: { message: expect.stringContaining('Java 21') } })
  })
})

describe('server.delete', () => {
  it('archives the folder, removes the firewall rule and the user', async () => {
    mkdirSync(join(paths.servers, 'survival'), { recursive: true })
    const { exec, calls } = fakeExec({
      'ufw status numbered': {
        stdout: [
          '[ 1] 22/tcp     ALLOW IN    Anywhere',
          '[ 2] 25565/tcp  ALLOW IN    Anywhere    # flytower server survival',
          '[ 3] 25565/tcp (v6) ALLOW IN Anywhere (v6) # flytower server survival',
        ].join('\n'),
      },
    })
    const { ctx } = fakeContext(exec, undefined, paths)
    const res = await dispatch(
      JSON.stringify({ id: 'd', verb: 'server.delete', params: { name: 'survival' } }),
      handlers,
      ctx,
    )
    expect(res).toMatchObject({ ok: true })
    const cmds = calls.map((c) => [c.file, ...c.args].join(' '))
    expect(cmds.filter((c) => c.startsWith('ufw --force delete'))).toEqual([
      'ufw --force delete 3',
      'ufw --force delete 2',
    ])
    expect(cmds).toContain('userdel mc-survival')
    expect(cmds.find((c) => c.startsWith('tar -czf'))).toContain(paths.archive)
    expect(existsSync(join(paths.servers, 'survival'))).toBe(false)
  })

  it('only matches rules tagged for that exact server', () => {
    const out = '[ 4] 25566/tcp ALLOW IN Anywhere # flytower server survival-2\n'
    expect(ufwRuleNumbers(out, 'survival')).toEqual([])
  })
})

describe('server.permissions', () => {
  it('restores group access without following links', async () => {
    const { exec, calls } = fakeExec({ 'id -u mc-survival': { code: 1 } })
    const { ctx } = fakeContext(exec, undefined, paths)
    await dispatch(create(), handlers, ctx)
    calls.length = 0
    const req = JSON.stringify({
      id: 'p',
      verb: 'server.permissions',
      params: { name: 'survival' },
    })
    expect(await dispatch(req, handlers, ctx)).toMatchObject({ ok: true })
    const dir = join(paths.servers, 'survival')
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual([
      `chgrp -R --no-dereference flytower ${dir}`,
      `chmod -R g+rwX,o-rwx ${dir}`,
    ])
  })

  it('says when there is no such server', async () => {
    const { exec } = fakeExec({})
    const { ctx } = fakeContext(exec, undefined, paths)
    const req = JSON.stringify({ id: 'p', verb: 'server.permissions', params: { name: 'nope' } })
    expect(await dispatch(req, handlers, ctx)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
  })
})

describe('server.configure', () => {
  const configure = (params: Record<string, unknown>) =>
    JSON.stringify({ id: 'g', verb: 'server.configure', params: { name: 'survival', ...params } })

  it('rewrites memory in the env file and limits, keeping Java', async () => {
    const { exec } = fakeExec({ 'id -u mc-survival': { code: 1 } })
    const { ctx } = fakeContext(exec, undefined, paths)
    await dispatch(create(), handlers, ctx)
    const res = await dispatch(configure({ memoryMb: 2048 }), handlers, ctx)
    expect(res).toMatchObject({ ok: true })
    const env = readFileSync(join(paths.config, 'servers', 'survival.env'), 'utf8')
    expect(env).toContain(`JAVA_HOME=${paths.runtimes}/temurin-25`)
    expect(env).toContain('HEAP_MB=2048')
    const limits = readFileSync(
      join(paths.systemd, 'flytower-mc@survival.service.d', 'limits.conf'),
      'utf8',
    )
    expect(limits).toContain('MemoryMax=3072M')
  })

  it('switches Java, keeping the heap, and refuses a Java that is not installed', async () => {
    const { exec } = fakeExec({ 'id -u mc-survival': { code: 1 } })
    const { ctx } = fakeContext(exec, undefined, paths)
    await dispatch(create(), handlers, ctx)
    expect(await dispatch(configure({ javaMajor: 21 }), handlers, ctx)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Java 21 is not installed') },
    })
    mkdirSync(join(paths.runtimes, 'temurin-21', 'bin'), { recursive: true })
    writeFileSync(join(paths.runtimes, 'temurin-21', 'bin', 'java'), '')
    expect(await dispatch(configure({ javaMajor: 21 }), handlers, ctx)).toMatchObject({ ok: true })
    const env = readFileSync(join(paths.config, 'servers', 'survival.env'), 'utf8')
    expect(env).toContain(`JAVA_HOME=${paths.runtimes}/temurin-21`)
    expect(env).toMatch(/^HEAP_MB=\d+$/m)
  })

  it('swaps the firewall rule for a new port', async () => {
    const status = [
      'Status: active',
      '[ 1] 22/tcp                     ALLOW IN    Anywhere',
      '[ 2] 25565/tcp                  ALLOW IN    Anywhere                   # flytower server survival',
    ].join('\n')
    const { exec, calls } = fakeExec({
      'id -u mc-survival': { code: 1 },
      'ufw status numbered': { stdout: status },
    })
    const { ctx } = fakeContext(exec, undefined, paths)
    await dispatch(create(), handlers, ctx)
    calls.length = 0
    expect(await dispatch(configure({ port: 25570 }), handlers, ctx)).toMatchObject({ ok: true })
    const cmds = calls.map((c) => [c.file, ...c.args].join(' '))
    expect(cmds).toEqual([
      'ufw status numbered',
      'ufw --force delete 2',
      'ufw allow 25570/tcp comment flytower server survival',
    ])
  })

  it('refuses an empty change or an unknown server', async () => {
    const { exec } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    expect(await dispatch(configure({}), handlers, ctx)).toMatchObject({
      ok: false,
      error: { code: 'invalid_params' },
    })
    expect(await dispatch(configure({ port: 30000 }), handlers, ctx)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    })
  })
})

describe('service.usage', () => {
  it('reads CPU and memory for running servers and nothing for stopped ones', async () => {
    const show = [
      'Id=flytower-mc@survival.service',
      'ActiveState=active',
      'CPUUsageNSec=123456789000',
      'MemoryCurrent=2147483648',
      '',
      'Id=flytower-mc@creative.service',
      'ActiveState=inactive',
      'CPUUsageNSec=[not set]',
      'MemoryCurrent=18446744073709551615',
      '',
    ].join('\n')
    const { exec, calls } = fakeExec({ 'systemctl show': { stdout: show } })
    const { ctx } = fakeContext(exec)
    const res = await dispatch(
      JSON.stringify({
        id: 'u',
        verb: 'service.usage',
        params: { servers: ['survival', 'creative'] },
      }),
      handlers,
      ctx,
    )
    expect(res).toMatchObject({
      ok: true,
      result: {
        usage: {
          survival: { active: true, cpuNs: 123456789000, memoryBytes: 2147483648 },
          creative: { active: false, cpuNs: null, memoryBytes: null },
        },
      },
    })
    expect(calls[0]!.args).toContain('flytower-mc@survival.service')
  })
})

describe('refreshTemplate', () => {
  it('does nothing before any server exists', async () => {
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    expect(await refreshTemplate(ctx)).toBe(false)
    expect(existsSync(join(paths.systemd, 'flytower-mc@.service'))).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('rewrites an old template and reloads systemd, without restarting anything', async () => {
    mkdirSync(paths.systemd, { recursive: true })
    const file = join(paths.systemd, 'flytower-mc@.service')
    writeFileSync(file, '# an older template\n[Service]\nRestart=on-failure\n')
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    expect(await refreshTemplate(ctx)).toBe(true)
    const unit = readFileSync(file, 'utf8')
    expect(unit).toContain('StartLimitIntervalSec=600')
    expect(unit).toContain('StartLimitBurst=3')
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual(['systemctl daemon-reload'])
  })

  it('leaves a current template alone', async () => {
    mkdirSync(paths.systemd, { recursive: true })
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, paths)
    writeFileSync(join(paths.systemd, 'flytower-mc@.service'), templateUnit(ctx))
    expect(await refreshTemplate(ctx)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
