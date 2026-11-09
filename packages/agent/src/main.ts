import { realExec } from './exec.ts'
import { handlers } from './handlers/index.ts'
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
  },
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

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close()
    process.exit(0)
  })
}
