import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { dispatch } from '../src/dispatch'
import { agentExecStart, setAgentExecStart, updaterCommand } from '../src/entry-points'
import { handlers } from '../src/handlers'
import { refreshAgentUnit } from '../src/handlers/update'
import { runUpdate } from '../src/updater'
import { fakeContext, fakeExec } from './fakes'

const UNIT = (exec: string) =>
  `[Service]\n${exec}\nEnvironment=FLYTOWER_VERSION=0.4.0\nRestart=always\n`
const OLD_EXEC = (prefix: string) =>
  `ExecStart=${prefix}/current/bin/bun ${prefix}/current/agent/agent.js`
const NEW_EXEC = (prefix: string) => `ExecStart=${prefix}/current/bin/flytower-agent`

/** A machine running 0.4.0 (from before the wrappers) with 0.5.0 (with them) installed. */
function machine() {
  const root = mkdtempSync(join(tmpdir(), 'ft-entry-'))
  const prefix = join(root, 'opt')
  const p = {
    servers: join(root, 'srv'),
    runtimes: join(prefix, 'runtimes'),
    archive: join(root, 'archive'),
    config: join(root, 'etc'),
    systemd: join(root, 'systemd'),
    state: join(root, 'state'),
    prefix,
    panelData: join(root, 'data'),
  }
  for (const d of [p.config, p.systemd, p.state, p.panelData]) mkdirSync(d, { recursive: true })
  for (const v of ['0.4.0', '0.5.0']) {
    const dir = join(prefix, 'releases', v)
    mkdirSync(join(dir, 'bin'), { recursive: true })
    mkdirSync(join(dir, 'agent'), { recursive: true })
    writeFileSync(join(dir, 'VERSION'), v)
    writeFileSync(join(dir, 'bin', 'bun'), '')
    writeFileSync(join(dir, 'agent', 'updater.js'), '')
  }
  for (const w of ['flytower-agent', 'flytower-updater']) {
    writeFileSync(join(prefix, 'releases', '0.5.0', 'bin', w), '#!/bin/sh\n')
  }
  symlinkSync(join(prefix, 'releases', '0.4.0'), join(prefix, 'current'))
  writeFileSync(join(p.config, 'panel.env'), 'NUXT_VERSION=0.4.0\nPORT=3000\n')
  writeFileSync(join(p.systemd, 'flytower-agent.service'), UNIT(OLD_EXEC(prefix)))
  return { p, prefix, unit: () => readFileSync(join(p.systemd, 'flytower-agent.service'), 'utf8') }
}

describe('entry points', () => {
  it('use the wrapper when a release has one, and Bun before that', () => {
    const { prefix } = machine()
    expect(agentExecStart(prefix, join(prefix, 'releases', '0.5.0'))).toBe(NEW_EXEC(prefix))
    expect(agentExecStart(prefix, join(prefix, 'releases', '0.4.0'))).toBe(OLD_EXEC(prefix))
    expect(updaterCommand(join(prefix, 'releases', '0.5.0'))).toEqual([
      join(prefix, 'releases', '0.5.0', 'bin', 'flytower-updater'),
    ])
    expect(updaterCommand(join(prefix, 'releases', '0.4.0'))).toEqual([
      join(prefix, 'releases', '0.4.0', 'bin', 'bun'),
      join(prefix, 'releases', '0.4.0', 'agent', 'updater.js'),
    ])
  })

  it('rewrite only the ExecStart line, and only when it changes', async () => {
    const { p, prefix, unit } = machine()
    const release = join(prefix, 'releases', '0.5.0')
    expect(await setAgentExecStart(p.systemd, prefix, release)).toBe(true)
    expect(unit()).toBe(UNIT(NEW_EXEC(prefix)))
    expect(await setAgentExecStart(p.systemd, prefix, release)).toBe(false)
  })

  it('leave a missing unit, or one without ExecStart, alone', async () => {
    const { p, prefix } = machine()
    const release = join(prefix, 'releases', '0.5.0')
    expect(await setAgentExecStart(join(p.systemd, 'nowhere'), prefix, release)).toBe(false)
    writeFileSync(join(p.systemd, 'flytower-agent.service'), '[Service]\n')
    expect(await setAgentExecStart(p.systemd, prefix, release)).toBe(false)
  })
})

describe('the agent unit', () => {
  it('moves to the wrapper when the agent starts from a release that has one', async () => {
    const { p, prefix, unit } = machine()
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, p)
    expect(await refreshAgentUnit(ctx)).toBe(false) // 0.4.0 has no wrapper
    expect(calls).toEqual([])

    rmSync(join(prefix, 'current'))
    symlinkSync(join(prefix, 'releases', '0.5.0'), join(prefix, 'current'))
    expect(await refreshAgentUnit(ctx)).toBe(true)
    expect(unit()).toContain(NEW_EXEC(prefix))
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual(['systemctl daemon-reload'])
  })

  it('follows the updater to a new release and back again on a rollback', async () => {
    const { p, prefix, unit } = machine()
    const { exec } = fakeExec()
    const deps = {
      ...p,
      exec,
      sleep: async () => {},
      healthTimeoutMs: 0,
    }
    const up = await runUpdate(
      { ...deps, health: async () => ({ version: '0.5.0', agent: { ok: true } }) },
      '0.5.0',
    )
    expect(up.state).toBe('succeeded')
    expect(unit()).toContain(NEW_EXEC(prefix))
    expect(unit()).toContain('FLYTOWER_VERSION=0.5.0')

    // A broken 0.4.0 → 0.5.0 update puts the old ExecStart back with the old release.
    const { p: q, prefix: qp, unit: qUnit } = machine()
    const broken = await runUpdate(
      {
        ...q,
        exec,
        sleep: async () => {},
        healthTimeoutMs: 0,
        health: async () => ({ version: '0.4.0', agent: { ok: true } }),
      },
      '0.5.0',
    )
    expect(broken.state).toBe('rolled-back')
    expect(qUnit()).toBe(UNIT(OLD_EXEC(qp)))
  })

  it('is pointed at an older release before its updater, which predates wrappers, runs', async () => {
    const { p, prefix, unit } = machine()
    rmSync(join(prefix, 'current'))
    symlinkSync(join(prefix, 'releases', '0.5.0'), join(prefix, 'current'))
    writeFileSync(join(p.systemd, 'flytower-agent.service'), UNIT(NEW_EXEC(prefix)))
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, p)
    const res = await dispatch(
      JSON.stringify({ id: '1', verb: 'update.rollback', params: { version: '0.4.0' } }),
      handlers,
      ctx,
    )
    expect(res).toMatchObject({ ok: true })
    expect(unit()).toContain(OLD_EXEC(prefix))
    const run = calls.find((c) => c.file === 'systemd-run')!
    expect(run.args).toContain(join(prefix, 'releases', '0.4.0', 'agent', 'updater.js'))
  })

  it('starts a new release through its updater wrapper', async () => {
    const { p, prefix } = machine()
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec, undefined, p)
    rmSync(join(prefix, 'current'))
    symlinkSync(join(prefix, 'releases', '0.4.0'), join(prefix, 'current'))
    // Roll "back" to 0.5.0, which is installed and has the wrapper.
    const res = await dispatch(
      JSON.stringify({ id: '1', verb: 'update.rollback', params: { version: '0.5.0' } }),
      handlers,
      ctx,
    )
    expect(res).toMatchObject({ ok: true })
    const run = calls.find((c) => c.file === 'systemd-run')!
    expect(run.args).toContain(join(prefix, 'releases', '0.5.0', 'bin', 'flytower-updater'))
    expect(run.args).not.toContain(join(prefix, 'releases', '0.5.0', 'bin', 'bun'))
  })
})
