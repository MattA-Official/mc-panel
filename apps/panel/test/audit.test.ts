import { describe, expect, it } from 'bun:test'
import { auditActor, auditKind, describeAudit, safeDetail } from '../shared/utils/audit'

describe('audit', () => {
  it('describes actions as sentences', () => {
    expect(describeAudit('server.clone', 'copy', { from: 'survival', withWorld: false })).toBe(
      'Cloned survival as copy, without its world',
    )
    expect(describeAudit('server.stop', 'survival', null)).toBe('Stopped survival')
    expect(describeAudit('players.ban', 'survival', { player: 'Steve', reason: 'griefing' })).toBe(
      'Banned Steve on survival (griefing)',
    )
    expect(describeAudit('files.rename', 'survival', { from: 'a', to: 'b' })).toBe(
      'Renamed a to b on survival',
    )
    expect(describeAudit('world.pregen.start', 'survival', { radius: 2000 })).toBe(
      'Started pre-generating survival, radius 2000',
    )
    expect(describeAudit('server.resources', 's', { memoryMb: 4096, hostname: null })).toBe(
      'Changed s: memory 4 GB, address removed',
    )
    expect(describeAudit('something.new', 's', null)).toBe('something.new on s')
  })

  it('groups actions into kinds', () => {
    expect(auditKind('server.apply')).toBe('content')
    expect(auditKind('ssh.open')).toBe('access')
    expect(auditKind('server.start')).toBe('servers')
    expect(auditKind('world.pregen.pause')).toBe('world')
  })

  it('never passes secrets through', () => {
    expect(safeDetail({ rconPassword: 'x', token: 'y', apiKey: 'z', path: 'ok' })).toEqual({
      path: 'ok',
    })
  })

  it('describes crashes, credited to Flytower', () => {
    expect(describeAudit('server.crashed', 'survival', { cause: 'It exited with code 1.' })).toBe(
      'survival crashed. It exited with code 1.',
    )
    expect(describeAudit('server.unresponsive', 'survival', { restarted: true })).toBe(
      'survival stopped responding, so it was restarted',
    )
    expect(auditKind('server.crash_loop')).toBe('servers')
    expect(auditActor('server.crashed', null)).toBe('Flytower')
    expect(auditActor('server.stop', null)).toBeNull()
    expect(auditActor('server.stop', 'Matt')).toBe('Matt')
  })
  it('describes scheduled task runs, credited to Flytower when nobody pressed Run now', () => {
    expect(
      describeAudit('schedule.run', 'survival', {
        task: 'Restart (0 5 * * *)',
        result: 'Restarted in 41s (4 warnings)',
        ok: true,
      }),
    ).toBe('survival: Restart (0 5 * * *). Restarted in 41s (4 warnings)')
    expect(auditActor('schedule.run', null)).toBe('Flytower')
    expect(auditActor('schedule.run', 'Matt')).toBe('Matt')
  })
})
