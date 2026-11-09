import { realExec } from './exec.ts'
import { handlers } from './handlers/index.ts'
import { restoreSsh } from './handlers/ssh.ts'
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
    archive: env('FLYTOWER_ARCHIVE_DIR', '/var/lib/flytower/archive'),
    config: env('FLYTOWER_CONFIG_DIR', '/etc/flytower'),
    systemd: env('FLYTOWER_SYSTEMD_DIR', '/etc/systemd/system'),
    state: env('FLYTOWER_AGENT_STATE_DIR', '/var/lib/flytower/agent'),
    prefix: env('FLYTOWER_PREFIX', '/opt/flytower'),
    panelData: env('FLYTOWER_PANEL_DATA', '/var/lib/flytower'),
  },
  releasesUrl: env(
    'FLYTOWER_RELEASES_URL',
    'https://github.com/MattA-Official/mc-panel/releases/download',
  ),
  panelGroup: env('FLYTOWER_PANEL_GROUP', 'flytower'),
  // stdout goes to the journal; one JSON line per request.
  log: (e: unknown) => console.log(JSON.stringify({ audit: e })),
}

if (process.getuid?.() !== 0) {
  console.error('flytower-agent must run as root')
  process.exit(1)
}

const server = await listen(
  {
    socketPath: env('FLYTOWER_AGENT_SOCKET', '/run/flytower/agent.sock'),
    group: ctx.panelGroup,
  },
  handlers,
  ctx,
)
console.log(`flytower-agent ${ctx.version} listening`)
// An emergency SSH opening must end on time even if the agent restarted in between.
await restoreSsh(ctx).catch((err) => console.error('restoring the SSH timer failed', err))

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close()
    process.exit(0)
  })
}
