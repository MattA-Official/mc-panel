import { describe, expect, it } from 'bun:test'
import { auditKind, describeAudit, safeDetail } from '../shared/utils/audit'

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
})
