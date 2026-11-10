/**
 * Keeps the Caddyfile the installer wrote up to date. Since 1.2, a server's own hostname
 * shows its public status page, which needs Caddy to get certificates on demand. Only the
 * installer wrote that, so installs from before 1.2 that were updated from the panel never
 * got it and their hostnames failed the HTTPS handshake. The agent adds it when it starts.
 */
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentContext } from './context.ts'

export const DEFAULT_CADDYFILE = '/etc/caddy/Caddyfile'
const MARKER = '# Managed by Flytower'
const ASK = '/api/public/tls-ask'

/**
 * The Caddyfile for a panel on `domain`, with every other name a server hostname whose page
 * Caddy checks with the panel first. Must match what installer/install.sh writes.
 */
export function caddyfile(domain: string, port: number): string {
  return `# Managed by Flytower. Re-running the installer rewrites this file.
{
	on_demand_tls {
		ask http://127.0.0.1:${port}${ASK}
	}
}

${domain} {
	encode zstd gzip
	reverse_proxy 127.0.0.1:${port}
}

https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:${port}
}
`
}

/** The panel's domain and port, from the panel.env the installer wrote. */
export function panelAddress(env: string): { domain: string; port: number } | null {
  const domain = /^NUXT_RP_ID=(.*)$/m.exec(env)?.[1]?.trim() ?? ''
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return null
  const port = Number(/^PORT=(\d+)$/m.exec(env)?.[1] ?? 3000)
  return { domain, port }
}

/**
 * Rewrites a Caddyfile the installer wrote that can't serve server hostnames yet, and
 * reloads Caddy. A Caddyfile without the installer's marker is the person's own and is left
 * alone. The old file is kept beside it as Caddyfile.before-hostnames.
 *
 * @returns whether the file was changed.
 * @throws if Caddy rejects the new file (the old one stays) or won't reload.
 */
export async function refreshCaddyfile(ctx: AgentContext): Promise<boolean> {
  const path = ctx.paths.caddyfile ?? DEFAULT_CADDYFILE
  const current = await readFile(path, 'utf8').catch(() => null)
  if (current === null || !current.startsWith(MARKER) || current.includes(ASK)) return false
  const env = await readFile(join(ctx.paths.config, 'panel.env'), 'utf8').catch(() => '')
  const panel = panelAddress(env)
  if (!panel) return false

  const next = `${path}.new`
  await writeFile(next, caddyfile(panel.domain, panel.port), { mode: 0o644 })
  const check = await ctx.exec('caddy', ['validate', '--config', next, '--adapter', 'caddyfile'])
  if (check.code !== 0) {
    await rm(next, { force: true })
    throw new Error(`caddy validate: ${check.stderr.trim() || 'failed'}`)
  }
  await copyFile(path, `${path}.before-hostnames`)
  await rename(next, path)
  const reload = await ctx.exec('systemctl', ['reload-or-restart', 'caddy'])
  if (reload.code !== 0) {
    throw new Error(`systemctl reload-or-restart caddy: ${reload.stderr.trim() || 'failed'}`)
  }
  return true
}
