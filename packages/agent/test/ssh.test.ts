import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { dispatch } from '../src/dispatch.ts'
import { handlers } from '../src/handlers/index.ts'
import { armed, restoreSsh, sshRuleNumbers } from '../src/handlers/ssh.ts'
import type { AgentContext } from '../src/context.ts'
import { fakeContext } from './fakes.ts'

/** A stateful fake ufw: rules come and go as the agent adds and deletes them. */
function fakeUfw(opts: { active?: boolean; rules?: string[]; sshdPorts?: string } = {}) {
  const rules = [...(opts.rules ?? ['OpenSSH', '80/tcp', '443/tcp', 'OpenSSH (v6)'])]
  const calls: string[] = []
  const exec = async (file: string, args: readonly string[]) => {
    const cmd = [file, ...args].join(' ')
    calls.push(cmd)
    if (cmd === 'sshd -T')
      return { code: 0, stdout: opts.sshdPorts ?? 'port 22\nlistenaddress 0.0.0.0\n', stderr: '' }
    if (cmd === 'ufw status numbered') {
      const head =
        opts.active === false ? 'Status: inactive\n' : 'Status: active\n\n     To  Action  From\n'
      const body = rules
        .map((r, i) => `[${String(i + 1).padStart(2)}] ${r.padEnd(26)} ALLOW IN    Anywhere`)
        .join('\n')
      return { code: 0, stdout: head + (opts.active === false ? '' : body), stderr: '' }
    }
    if (file === 'ufw' && args[0] === '--force' && args[1] === 'delete') {
      rules.splice(Number(args[2]) - 1, 1)
      return { code: 0, stdout: '', stderr: '' }
    }
    if (file === 'ufw' && args[0] === 'allow') {
      rules.push(args[1]!, `${args[1]} (v6)`)
      return { code: 0, stdout: '', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { exec, rules, calls }
}

let clock = Date.UTC(2026, 10, 9, 12)
function context(exec: ReturnType<typeof fakeUfw>['exec']) {
  const { ctx } = fakeContext(exec as never)
  const state = mkdtempSync(join(tmpdir(), 'ft-ssh-'))
  const c: AgentContext = { ...ctx, paths: { ...ctx.paths, state }, now: () => clock }
  return c
}
const call = (ctx: AgentContext, verb: string, params: object = {}) =>
  dispatch(JSON.stringify({ id: 'x', verb, params }), handlers, ctx)

afterEach(() => {
  clock = Date.UTC(2026, 10, 9, 12)
})

describe('ssh', () => {
  it('finds SSH rules for any port sshd uses, v4 and v6, highest first', () => {
    const out = [
      'Status: active',
      '[ 1] OpenSSH                    ALLOW IN    Anywhere',
      '[ 2] 2222/tcp                   LIMIT IN    Anywhere',
      '[ 3] 25565/tcp                  ALLOW IN    Anywhere  # flytower server survival',
      '[ 4] OpenSSH (v6)               ALLOW IN    Anywhere (v6)',
    ].join('\n')
    expect(sshRuleNumbers(out, [22, 2222])).toEqual([4, 2, 1])
  })

  it('closes every SSH rule and leaves the rest', async () => {
    const ufw = fakeUfw()
    const ctx = context(ufw.exec)
    const res = await call(ctx, 'ssh.set', { open: false })
    expect(res).toMatchObject({ ok: true, result: { open: false, ports: [22], closesAt: null } })
    expect(ufw.rules).toEqual(['80/tcp', '443/tcp'])
  })

  it('opens for a while, then closes by itself', async () => {
    const ufw = fakeUfw({ rules: ['80/tcp'] })
    const ctx = context(ufw.exec)
    const res = await call(ctx, 'ssh.set', { open: true, minutes: 60 })
    expect(res).toMatchObject({
      ok: true,
      result: { open: true, closesAt: '2026-11-09T13:00:00.000Z' },
    })
    expect(ufw.rules).toContain('22/tcp')
    expect(ufw.calls).toContain(`ufw allow 22/tcp comment flytower emergency ssh`)
    expect(armed(ctx)).toBe(true)
    expect(JSON.parse(await readFile(join(ctx.paths.state, 'ssh.json'), 'utf8'))).toEqual({
      closesAt: '2026-11-09T13:00:00.000Z',
    })
    // Close it, as the timer would.
    await call(ctx, 'ssh.set', { open: false })
    expect(armed(ctx)).toBe(false)
    expect(ufw.rules).toEqual(['80/tcp'])
  })

  it('at boot, closes a window that ended and re-arms one still open', async () => {
    const ufw = fakeUfw({ rules: ['80/tcp'] })
    const ctx = context(ufw.exec)
    await call(ctx, 'ssh.set', { open: true, minutes: 30 })
    // The agent restarts 10 minutes later: the timer comes back.
    clock += 10 * 60_000
    await call(ctx, 'ssh.set', { open: false }).then(() => {})
    await call(ctx, 'ssh.set', { open: true, minutes: 30 })
    await restoreSsh(ctx)
    expect(armed(ctx)).toBe(true)
    expect(ufw.rules).toContain('22/tcp')
    // It restarts after the window ended: SSH is closed straight away.
    clock += 31 * 60_000
    await restoreSsh(ctx)
    expect(ufw.rules).toEqual(['80/tcp'])
    expect(armed(ctx)).toBe(false)
  })

  it('refuses when ufw is off, and refuses minutes when closing', async () => {
    const ctx = context(fakeUfw({ active: false }).exec)
    expect(await call(ctx, 'ssh.set', { open: false })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('ufw') },
    })
    expect(
      await call(context(fakeUfw().exec), 'ssh.set', { open: false, minutes: 5 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_params' },
    })
  })

  it('opening for good clears any timer', async () => {
    const ufw = fakeUfw({ rules: [] })
    const ctx = context(ufw.exec)
    await call(ctx, 'ssh.set', { open: true, minutes: 5 })
    const res = await call(ctx, 'ssh.set', { open: true })
    expect(res).toMatchObject({ ok: true, result: { open: true, closesAt: null } })
    expect(armed(ctx)).toBe(false)
    expect(ufw.rules.filter((r) => r.startsWith('22/tcp'))).toHaveLength(2)
  })
})
