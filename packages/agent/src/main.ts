import { duBinary } from './du.ts'
import { refreshCaddyfile } from './caddy.ts'
import { UnitEvents } from './events.ts'
import { realExec } from './exec.ts'
import { prepareFolders } from './folders.ts'
import { handlers } from './handlers/index.ts'
import { refreshTemplate } from './handlers/server.ts'
import { restoreSsh } from './handlers/ssh.ts'
import { refreshAgentUnit } from './handlers/update.ts'
import { listen } from './server.ts'

const env = (name: string, fallback: string) => process.env[name] ?? fallback

const ctx = {
  exec: realExec,
  fetch: globalThis.fetch,
  arch: process.arch,
  version: env('FLYTOWER_VERSION', '0.0.0-dev'),
  paths: {
    servers: env('FLYTOWER_SERVERS_DIR', '/srv/flytower/servers'),
    runtimes: env('FLYTOWER_RUNTIMES_DIR', '/opt/flytower/runtimes'),
    archive: env('FLYTOWER_ARCHIVE_DIR', '/var/lib/flytower-archive'),
    config: env('FLYTOWER_CONFIG_DIR', '/etc/flytower'),
    systemd: env('FLYTOWER_SYSTEMD_DIR', '/etc/systemd/system'),
    state: env('FLYTOWER_AGENT_STATE_DIR', '/var/lib/flytower-agent'),
    prefix: env('FLYTOWER_PREFIX', '/opt/flytower'),
    panelData: env('FLYTOWER_PANEL_DATA', '/var/lib/flytower'),
    caddyfile: env('FLYTOWER_CADDYFILE', '/etc/caddy/Caddyfile'),
    socket: env('FLYTOWER_AGENT_SOCKET', '/run/flytower/agent.sock'),
  },
  releasesUrl: env(
    'FLYTOWER_RELEASES_URL',
    'https://github.com/MattA-Official/mc-panel/releases/download',
  ),
  panelGroup: env('FLYTOWER_PANEL_GROUP', 'flytower'),
  du: duBinary(),
  // stdout goes to the journal; one JSON line per request.
  log: (e: unknown) => console.log(JSON.stringify({ audit: e })),
  unitEvents: new UnitEvents(),
}
ctx.unitEvents.start()

if (process.getuid?.() !== 0) {
  console.error('flytower-agent must run as root')
  process.exit(1)
}

const server = await listen(
  {
    socketPath: ctx.paths.socket ?? '/run/flytower/agent.sock',
    group: ctx.panelGroup,
  },
  handlers,
  ctx,
)
console.log(`flytower-agent ${ctx.version} listening`)
// Before anything reads or writes state: the folders, and what older releases left behind.
await prepareFolders(ctx).catch((err) => console.error("preparing the agent's folders failed", err))
// An emergency SSH opening must end on time even if the agent restarted in between.
await restoreSsh(ctx).catch((err) => console.error('restoring the SSH timer failed', err))
await refreshTemplate(ctx).then(
  (changed) => changed && console.log('updated the server unit template'),
  (err) => console.error('updating the server unit template failed', err),
)
await refreshAgentUnit(ctx).then(
  (changed) => changed && console.log('pointed the agent unit at bin/flytower-agent'),
  (err) => console.error('updating the agent unit failed', err),
)
await refreshCaddyfile(ctx).then(
  (changed) => changed && console.log('added server hostnames to the Caddyfile'),
  (err) => console.error('updating the Caddyfile failed', err),
)

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close()
    process.exit(0)
  })
}
