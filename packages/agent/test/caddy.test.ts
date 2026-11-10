import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { caddyfile, panelAddress, refreshCaddyfile } from '../src/caddy'
import type { ExecResult } from '../src/exec'
import { fakeContext, fakeExec } from './fakes'

/** What the installer wrote before 1.2: the panel's domain only. */
const OLD = `# Managed by Flytower. Re-running the installer rewrites this file.
panel.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
`
const ENV = 'NUXT_APP_SECRET=x\nNUXT_RP_ID=panel.example.com\nPORT=3000\n'

function machine(
  file: string | null,
  env = ENV,
  answers: Record<string, Partial<ExecResult>> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'ft-caddy-'))
  const config = join(root, 'etc')
  mkdirSync(config)
  writeFileSync(join(config, 'panel.env'), env)
  const path = join(root, 'Caddyfile')
  if (file !== null) writeFileSync(path, file)
  const { exec, calls } = fakeExec(answers)
  const { ctx } = fakeContext(exec, undefined, {
    servers: join(root, 'srv'),
    runtimes: join(root, 'runtimes'),
    archive: join(root, 'archive'),
    config,
    systemd: join(root, 'systemd'),
    state: join(root, 'state'),
    caddyfile: path,
  })
  return { ctx, calls, path }
}

describe('refreshCaddyfile', () => {
  it('adds server hostnames to a Caddyfile from before 1.2, keeps the old one and reloads', async () => {
    const { ctx, calls, path } = machine(OLD)
    expect(await refreshCaddyfile(ctx)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(caddyfile('panel.example.com', 3000))
    expect(readFileSync(`${path}.before-hostnames`, 'utf8')).toBe(OLD)
    expect(existsSync(`${path}.new`)).toBe(false)
    expect(calls.map((c) => [c.file, ...c.args].join(' '))).toEqual([
      `caddy validate --config ${path}.new --adapter caddyfile`,
      'systemctl reload-or-restart caddy',
    ])
  })

  it('uses the port in panel.env', async () => {
    const { ctx, path } = machine(OLD, 'NUXT_RP_ID=panel.example.com\nPORT=3100\n')
    await refreshCaddyfile(ctx)
    expect(readFileSync(path, 'utf8')).toContain('ask http://127.0.0.1:3100/api/public/tls-ask')
  })

  it('leaves a Caddyfile that already serves hostnames alone', async () => {
    const current = caddyfile('panel.example.com', 3000)
    const { ctx, calls, path } = machine(current)
    expect(await refreshCaddyfile(ctx)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(current)
    expect(calls).toEqual([])
  })

  it("leaves the person's own Caddyfile alone", async () => {
    const own = 'panel.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n'
    const { ctx, calls, path } = machine(own)
    expect(await refreshCaddyfile(ctx)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(own)
    expect(calls).toEqual([])
  })

  it('does nothing without Caddy (--no-caddy) or without a domain', async () => {
    expect(await refreshCaddyfile(machine(null).ctx)).toBe(false)
    expect(await refreshCaddyfile(machine(OLD, 'PORT=3000\n').ctx)).toBe(false)
  })

  it('keeps the old file when Caddy rejects the new one', async () => {
    const { ctx, calls, path } = machine(OLD, ENV, {
      'caddy validate': { code: 1, stderr: 'bad config' },
    })
    await expect(refreshCaddyfile(ctx)).rejects.toThrow('caddy validate: bad config')
    expect(readFileSync(path, 'utf8')).toBe(OLD)
    expect(existsSync(`${path}.new`)).toBe(false)
    expect(calls.some((c) => c.file === 'systemctl')).toBe(false)
  })
})

describe('caddyfile', () => {
  it('is what the installer writes', () => {
    const script = readFileSync(join(import.meta.dir, '../../../installer/install.sh'), 'utf8')
    const heredoc = /cat >"\$caddyfile" <<EOF\n([\s\S]*?)\nEOF\n/.exec(script)?.[1]
    expect(heredoc).toBeDefined()
    const written = `${heredoc}\n`
      .replaceAll('$domain', 'panel.example.com')
      .replaceAll('$PANEL_PORT', '3000')
    expect(caddyfile('panel.example.com', 3000)).toBe(written)
  })
})

describe('panelAddress', () => {
  it('reads the domain and port, defaulting the port', () => {
    expect(panelAddress(ENV)).toEqual({ domain: 'panel.example.com', port: 3000 })
    expect(panelAddress('NUXT_RP_ID=a.example\n')).toEqual({ domain: 'a.example', port: 3000 })
    expect(panelAddress('NUXT_RP_ID=bad name\n')).toBeNull()
  })
})
