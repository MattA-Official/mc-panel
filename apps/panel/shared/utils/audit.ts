/** Turning audit rows into sentences, and grouping their actions for filtering. */

export const AUDIT_KINDS = {
  servers: 'Servers',
  content: 'Changes and content',
  backups: 'Backups',
  world: 'Worlds',
  players: 'Players',
  files: 'Files',
  access: 'Sign-ins and access',
  system: 'Flytower and notifications',
} as const
export type AuditKind = keyof typeof AUDIT_KINDS

export function auditKind(action: string): AuditKind {
  if (action.startsWith('backup.')) return 'backups'
  if (action.startsWith('world.')) return 'world'
  if (action.startsWith('players.')) return 'players'
  if (action.startsWith('files.')) return 'files'
  if (action === 'server.apply' || action === 'server.properties') return 'content'
  if (/^(auth|passkey|recovery|setup|ssh)\./.test(action)) return 'access'
  if (action.startsWith('update.') || action.startsWith('notify.')) return 'system'
  return 'servers'
}

/** Things Flytower records by itself, with nobody signed in behind them. */
const BY_FLYTOWER = [
  'server.crashed',
  'server.crash_loop',
  'server.unresponsive',
  'schedule.run',
]

/** Who to show for an entry with no user: Flytower for its own, otherwise a removed person. */
export function auditActor(action: string, user: string | null): string | null {
  return user ?? (BY_FLYTOWER.includes(action) ? 'Flytower' : null)
}

/** Detail keys that never leave the server. */
const SECRET = /pass|token|secret|key/i

export function safeDetail(detail: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (SECRET.test(k)) continue
    out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v
  }
  return out
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** A short sentence, without the person (shown alongside). */
export function describeAudit(
  action: string,
  target: string | null,
  detail: Record<string, unknown> | null,
): string {
  const d = safeDetail(detail)
  const t = target ?? ''
  switch (action) {
    case 'auth.login':
      return 'Signed in with a passkey'
    case 'auth.recovery_code':
      return 'Signed in with a recovery code'
    case 'setup.completed':
      return 'Set up Flytower'
    case 'passkey.added':
      return `Added a passkey${d.nickname ? ` (${str(d.nickname)})` : ''}`
    case 'passkey.removed':
      return `Removed a passkey${d.nickname ? ` (${str(d.nickname)})` : ''}`
    case 'recovery.reissued':
      return 'Made new recovery codes'
    case 'ssh.open':
      return `Opened SSH${d.minutes ? ` for ${str(d.minutes)} minutes` : ''}`
    case 'ssh.close':
      return 'Closed SSH'
    case 'update.install':
      return `Updated Flytower to ${str(d.version)}`
    case 'update.rollback':
      return `Went back to Flytower ${str(d.version)}`
    case 'update.channel':
      return d.channel === 'beta'
        ? 'Chose to be offered beta releases'
        : 'Chose stable releases only'
    case 'server.create':
      return `Created ${t}${d.from === 'spec' ? ' from YAML' : ''}`
    case 'server.import':
      return `Imported ${t}${d.label ? ` from ${str(d.label)}` : ''}`
    case 'server.import.unpack':
      return 'Unpacked an upload to import'
    case 'server.clone':
      return `Cloned ${str(d.from)} as ${t}${d.withWorld === false ? ', without its world' : ''}`
    case 'server.delete':
      return `Deleted ${t}`
    case 'server.start':
      return `Started ${t}`
    case 'server.crashed':
      return `${t} crashed${d.cause ? `. ${str(d.cause)}` : ''}`
    case 'server.crash_loop':
      return `${t} kept crashing, so it was left stopped`
    case 'server.unresponsive':
      return `${t} stopped responding${d.restarted ? ', so it was restarted' : ''}`
    case 'server.recovery':
      return d.restartWhenUnresponsive
        ? `Set ${t} to restart when it stops responding`
        : `Set ${t} not to restart when it stops responding`
    case 'server.stop':
      return `Stopped ${t}`
    case 'server.restart':
      return `Restarted ${t}`
    case 'server.command':
      return `Ran /${str(d.command).replace(/^\//, '')} on ${t}`
    case 'server.properties':
      return `Changed ${t}'s settings${Array.isArray(d.keys) ? ` (${d.keys.join(', ')})` : ''}`
    case 'server.resources': {
      const bits = [
        d.memoryMb ? `memory ${Number(d.memoryMb) / 1024} GB` : '',
        d.port ? `port ${str(d.port)}` : '',
        d.hostname === undefined
          ? ''
          : d.hostname
            ? `address ${str(d.hostname)}`
            : 'address removed',
      ].filter(Boolean)
      return bits.length ? `Changed ${t}: ${bits.join(', ')}` : `Changed ${t}'s resources`
    }
    case 'server.apply':
      return `Applied a plan to ${t}`
    case 'backup.create':
      return `Backed up ${t}${d.note ? ` (${str(d.note)})` : ''}`
    case 'backup.delete':
      return `Deleted a backup of ${t}`
    case 'backup.restore':
      return `Restored a backup of ${t}`
    case 'backup.schedule':
      return `Changed ${t}'s backup schedule`
    case 'schedule.update':
      return `Changed ${t}'s scheduled tasks`
    case 'schedule.run':
      return `${t}: ${str(d.task)}. ${str(d.result)}`
    case 'backup.offsite':
      return d.target
        ? `Started copying ${t}'s backups to ${str(d.target)}`
        : `Stopped copying ${t}'s backups off-site`
    case 'backup.target.add':
      return `Added the off-site backup target ${str(d.name)}`
    case 'backup.target.remove':
      return `Removed the off-site backup target ${str(d.name)}`
    case 'notify.channel.add':
      return `Added the notification channel ${str(d.name)}`
    case 'notify.channel.edit':
      return `Changed the notification channel ${str(d.name)}`
    case 'notify.channel.remove':
      return `Removed the notification channel ${str(d.name)}`
    case 'world.export':
      return `Exported ${t}'s world`
    case 'world.export.delete':
      return `Deleted an export of ${t}'s world`
    case 'world.share':
      return `Shared an export of ${t}'s world by link`
    case 'world.share.revoke':
      return `Revoked a share link for ${t}'s world`
    case 'world.reset':
      return `Reset ${t}'s world${d.seed ? ` with seed ${str(d.seed)}` : d.random ? ' with a new seed' : ''}`
    case 'world.copy':
      return `Copied ${str(d.from)}'s world into ${t}`
  }
  if (action.startsWith('world.pregen.')) {
    const what = action.slice(13)
    return what === 'start'
      ? `Started pre-generating ${t}${d.radius ? `, radius ${str(d.radius)}` : ''}`
      : `${what === 'continue' ? 'Continued' : what === 'pause' ? 'Paused' : 'Cancelled'} pre-generation on ${t}`
  }
  if (action.startsWith('players.')) {
    const verbs: Record<string, string> = {
      'whitelist-add': 'Whitelisted',
      'whitelist-remove': 'Took off the whitelist:',
      op: 'Made operator:',
      deop: 'Removed operator:',
      ban: 'Banned',
      pardon: 'Unbanned',
      kick: 'Kicked',
    }
    const verb = verbs[action.slice(8)] ?? action.slice(8)
    return `${verb} ${str(d.player)} on ${t}${d.reason ? ` (${str(d.reason)})` : ''}`
  }
  if (action.startsWith('files.')) {
    const what = action.slice(6)
    if (what === 'rename') return `Renamed ${str(d.from)} to ${str(d.to)} on ${t}`
    const verb =
      { upload: 'Uploaded', delete: 'Deleted', mkdir: 'Made folder', write: 'Edited' }[what] ?? what
    return `${verb} ${str(d.path ?? d.file)} on ${t}`
  }
  return `${action}${t ? ` on ${t}` : ''}`
}
