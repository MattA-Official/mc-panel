import { describe, expect, it } from 'bun:test'
import { dispatch, handlers } from '../src/index.ts'
import { fakeContext, fakeExec } from './fakes.ts'

const loaded = {
  'systemctl show flytower-mc@survival.service --property=LoadState': { stdout: 'loaded\n' },
}

const req = (verb: string, params: unknown = {}, id = 'r1') => JSON.stringify({ id, verb, params })

describe('dispatch', () => {
  it('answers ping with the protocol version', async () => {
    const { ctx } = fakeContext(fakeExec().exec)
    const res = await dispatch(req('ping'), handlers, ctx)
    expect(res).toEqual({ id: 'r1', ok: true, result: { agentVersion: '0.0.0-test', protocol: 1 } })
  })

  it('rejects junk, unknown verbs and bad params without running anything', async () => {
    const { exec, calls } = fakeExec()
    const { ctx } = fakeContext(exec)
    expect((await dispatch('{nope', handlers, ctx)).ok).toBe(false)
    const unknown = await dispatch(req('shell.run', { cmd: 'id' }), handlers, ctx)
    expect(unknown).toMatchObject({ ok: false, error: { code: 'unknown_verb' } })
    const proto = await dispatch(req('__proto__'), handlers, ctx)
    expect(proto).toMatchObject({ ok: false, error: { code: 'unknown_verb' } })
    const bad = await dispatch(req('service.start', { server: '../../etc' }), handlers, ctx)
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_params' } })
    expect(calls).toHaveLength(0)
  })

  it('audits every request, including failures', async () => {
    const { ctx, audit } = fakeContext(fakeExec().exec)
    await dispatch(req('ping', {}, 'a'), handlers, ctx)
    await dispatch(req('nope', {}, 'b'), handlers, ctx)
    expect(audit.map((e) => [e.id, e.verb, e.outcome])).toEqual([
      ['a', 'ping', 'ok'],
      ['b', 'nope', 'error'],
    ])
  })
})

describe('service verbs', () => {
  it('starts a known server with an argument list, not a shell string', async () => {
    const { exec, calls } = fakeExec(loaded)
    const { ctx } = fakeContext(exec)
    const res = await dispatch(req('service.start', { server: 'survival' }), handlers, ctx)
    expect(res.ok).toBe(true)
    expect(calls.at(-1)).toEqual({
      file: 'systemctl',
      args: ['start', 'flytower-mc@survival.service'],
    })
  })

  it('refuses a server systemd does not know', async () => {
    const { exec, calls } = fakeExec({ 'systemctl show': { stdout: 'not-found\n' } })
    const { ctx } = fakeContext(exec)
    const res = await dispatch(req('service.stop', { server: 'ghost' }), handlers, ctx)
    expect(res).toMatchObject({ ok: false, error: { code: 'not_found' } })
    expect(calls.some((c) => c.args[0] === 'stop')).toBe(false)
  })

  it('reports status', async () => {
    const { exec } = fakeExec({
      ...loaded,
      'systemctl show flytower-mc@survival.service --property=ActiveState,ActiveEnterTimestamp,Result,NRestarts,ExecMainCode,ExecMainStatus':
        {
          stdout:
            'ActiveState=active\nActiveEnterTimestamp=Mon 2026-11-09 12:00:00 UTC\nResult=success\nNRestarts=0\nExecMainCode=0\nExecMainStatus=0\n',
        },
    })
    const { ctx } = fakeContext(exec)
    const res = await dispatch(req('service.status', { server: 'survival' }), handlers, ctx)
    expect(res).toEqual({
      id: 'r1',
      ok: true,
      result: {
        active: 'active',
        since: 'Mon 2026-11-09 12:00:00 UTC',
        result: 'success',
        restarts: 0,
        exitKind: null,
        exitStatus: null,
      },
    })
  })

  it('reports how a crashed server ended while it waits to restart', async () => {
    const { exec } = fakeExec({
      ...loaded,
      'systemctl show flytower-mc@survival.service --property=ActiveState': {
        stdout:
          'ActiveState=activating\nActiveEnterTimestamp=\nResult=signal\nNRestarts=1\nExecMainCode=2\nExecMainStatus=9\n',
      },
    })
    const { ctx } = fakeContext(exec)
    const res = await dispatch(req('service.status', { server: 'survival' }), handlers, ctx)
    expect(res).toMatchObject({
      ok: true,
      result: {
        active: 'activating',
        since: null,
        result: 'signal',
        restarts: 1,
        exitKind: 'killed',
        exitStatus: 9,
      },
    })
  })

  it('clears a crash loop before starting', async () => {
    const { exec, calls } = fakeExec(loaded)
    const { ctx } = fakeContext(exec)
    await dispatch(req('service.start', { server: 'survival' }), handlers, ctx)
    const verbs = calls.filter((c) => c.args[0] !== 'show').map((c) => c.args.join(' '))
    expect(verbs).toEqual([
      'reset-failed flytower-mc@survival.service',
      'start flytower-mc@survival.service',
    ])
  })

  it("doesn't clear a crash loop when stopping", async () => {
    const { exec, calls } = fakeExec(loaded)
    const { ctx } = fakeContext(exec)
    await dispatch(req('service.stop', { server: 'survival' }), handlers, ctx)
    expect(calls.some((c) => c.args[0] === 'reset-failed')).toBe(false)
  })

  it('surfaces systemctl failures as failed', async () => {
    const { exec } = fakeExec({
      ...loaded,
      'systemctl restart': { code: 1, stderr: 'Job for flytower-mc@survival.service failed.' },
    })
    const { ctx } = fakeContext(exec)
    const res = await dispatch(req('service.restart', { server: 'survival' }), handlers, ctx)
    expect(res).toMatchObject({
      ok: false,
      error: { code: 'failed', message: 'Job for flytower-mc@survival.service failed.' },
    })
  })
})
