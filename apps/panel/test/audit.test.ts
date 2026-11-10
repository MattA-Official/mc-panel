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

  it('describes clean ups with what they freed', () => {
    const MB = 1024 * 1024
    expect(
      describeAudit('disk.clean', null, { action: 'journal', maxMb: 200, freedBytes: 300 * MB }),
    ).toBe('Shrank the system journal to 200 MB, freeing 300.0 MB')
    expect(describeAudit('disk.clean', null, { action: 'apt', freedBytes: 0 })).toBe(
      'Cleared the package cache, which freed nothing',
    )
    expect(
      describeAudit('disk.clean', null, { action: 'releases', freedBytes: 2 * 1024 * MB }),
    ).toBe('Removed old Flytower versions, freeing 2.00 GB')
    expect(auditKind('disk.clean')).toBe('system')
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

describe('access changes in Activity', () => {
  it('says which roles someone was given or lost', () => {
    const op = { role: 'Operator', server: 'Survival' }
    const viewer = { role: 'Viewer', server: null }
    expect(
      describeAudit('people.changed', null, { person: 'Alex', added: [op], removed: [] }),
    ).toBe('Gave Alex Operator on Survival')
    expect(
      describeAudit('people.changed', null, { person: 'Alex', added: [op], removed: [viewer] }),
    ).toBe('Gave Alex Operator on Survival, and took away Viewer on all servers')
    expect(
      describeAudit('people.changed', null, { person: 'Sam', added: [], removed: [viewer] }),
    ).toBe('Took Viewer on all servers away from Sam')
    // Entries from before 1.4.0 had no lists.
    expect(describeAudit('people.changed', null, { person: 'Sam', grants: [] })).toBe(
      'Changed what Sam can do',
    )
  })

  it('says which permissions a role gained or lost', () => {
    expect(
      describeAudit('people.role_saved', null, {
        name: 'Mods',
        created: false,
        added: ['files.read', 'files.write'],
        removed: ['console.read'],
      }),
    ).toBe(
      'Changed the Mods role: added Read files and Change files; removed Read the console and logs',
    )
    expect(describeAudit('people.role_saved', null, { name: 'Mods', created: true })).toBe(
      'Made the Mods role',
    )
  })
})
