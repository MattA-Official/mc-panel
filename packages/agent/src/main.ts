import { realExec } from './exec.ts'
import { handlers } from './handlers/index.ts'
import { listen } from './server.ts'

const env = (name: string, fallback: string) => process.env[name] ?? fallback

const ctx = {
  exec: realExec,
  fetch: globalThis.fetch,
  arch: process.arch,
  version: env('KILN_VERSION', '0.0.0-dev'),
  paths: {
    servers: env('KILN_SERVERS_DIR', '/srv/kiln/servers'),
    runtimes: env('KILN_RUNTIMES_DIR', '/opt/kiln/runtimes'),
    archive: env('KILN_ARCHIVE_DIR', '/var/lib/kiln/archive'),
    config: env('KILN_CONFIG_DIR', '/etc/kiln'),
    systemd: env('KILN_SYSTEMD_DIR', '/etc/systemd/system'),
  },
  panelGroup: env('KILN_PANEL_GROUP', 'kiln'),
  // stdout goes to the journal; one JSON line per request.
  log: (e: unknown) => console.log(JSON.stringify({ audit: e })),
}

if (process.getuid?.() !== 0) {
  console.error('kiln-agent must run as root')
  process.exit(1)
}

const server = await listen(
  {
    socketPath: env('KILN_AGENT_SOCKET', '/run/kiln/agent.sock'),
    group: ctx.panelGroup,
  },
  handlers,
  ctx,
)
console.log(`kiln-agent ${ctx.version} listening`)

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
