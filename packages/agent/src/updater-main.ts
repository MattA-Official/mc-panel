/**
 * Entry point for the updater, run by the agent as a transient systemd unit:
 *   bun updater.js <version> [--manual]
 */
import { realExec } from './exec.ts'
import { runUpdate } from './updater.ts'

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const [to, flag] = process.argv.slice(2)
if (!to || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(to)) {
  console.error('usage: updater.js <version> [--manual]')
  process.exit(2)
}

const record = await runUpdate(
  {
    prefix: env('FLYTOWER_PREFIX', '/opt/flytower'),
    panelData: env('FLYTOWER_PANEL_DATA', '/var/lib/flytower'),
    config: env('FLYTOWER_CONFIG_DIR', '/etc/flytower'),
    systemd: env('FLYTOWER_SYSTEMD_DIR', '/etc/systemd/system'),
    state: env('FLYTOWER_AGENT_STATE_DIR', '/var/lib/flytower/agent'),
    exec: realExec,
    health: async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return (await res.json()) as { version: string; agent: { ok: boolean } }
    },
  },
  to,
  flag === '--manual',
)
console.log(JSON.stringify(record))
process.exit(record.state === 'succeeded' ? 0 : 1)
