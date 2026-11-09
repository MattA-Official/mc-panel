import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError, unitName, userName, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'
import { envFile, limitsDropIn, templateUnit } from '../units.ts'

async function run(ctx: AgentContext, file: string, args: string[]) {
  const r = await ctx.exec(file, args)
  if (r.code !== 0) {
    throw new AgentError('failed', `${file} ${args[0] ?? ''}: ${r.stderr.trim() || 'failed'}`)
  }
  return r.stdout
}

const userExists = async (ctx: AgentContext, user: string) =>
  (await ctx.exec('id', ['-u', user])).code === 0

const paths = (ctx: AgentContext, name: string) => ({
  dir: join(ctx.paths.servers, name),
  env: join(ctx.paths.config, 'servers', `${name}.env`),
  dropInDir: join(ctx.paths.systemd, `${unitName(name)}.d`),
  template: join(ctx.paths.systemd, 'flytower-mc@.service'),
})

/** ufw rules are tagged so delete can find exactly the rule create added. */
export const ufwComment = (name: string) => `flytower server ${name}`

/**
 * Creates the OS side of a server: its user, its folder (owned by the server, group = the
 * panel, setgid so files stay manageable), its environment file, memory limits and a
 * firewall rule. It does not download Minecraft; the panel writes the jar into the folder.
 */
export async function create(
  p: Params<'server.create'>,
  ctx: AgentContext,
): Promise<Result<'server.create'>> {
  const user = userName(p.name)
  const f = paths(ctx, p.name)
  if (existsSync(f.dir) || (await userExists(ctx, user))) {
    throw new AgentError('conflict', `a server called ${p.name} already exists`)
  }
  const javaHome = join(ctx.paths.runtimes, `temurin-${p.javaMajor}`)
  if (!existsSync(join(javaHome, 'bin', 'java'))) {
    throw new AgentError(
      'failed',
      `Java ${p.javaMajor} is not installed; run runtime.install first`,
    )
  }

  await run(ctx, 'useradd', [
    '--system',
    '--home-dir',
    f.dir,
    '--no-create-home',
    '--shell',
    '/usr/sbin/nologin',
    '--user-group',
    user,
  ])
  await mkdir(f.dir, { recursive: true })
  await run(ctx, 'chown', [`${user}:${ctx.panelGroup}`, f.dir])
  await run(ctx, 'chmod', ['2770', f.dir])

  await mkdir(join(ctx.paths.config, 'servers'), { recursive: true, mode: 0o755 })
  await writeFile(f.env, envFile(javaHome, p.memoryMb), { mode: 0o644 })
  await mkdir(f.dropInDir, { recursive: true, mode: 0o755 })
  await writeFile(f.template, templateUnit(ctx), { mode: 0o644 })
  await writeFile(join(f.dropInDir, 'limits.conf'), limitsDropIn(p.memoryMb), { mode: 0o644 })
  await run(ctx, 'systemctl', ['daemon-reload'])
  await run(ctx, 'systemctl', ['enable', unitName(p.name)])
  await run(ctx, 'ufw', ['allow', `${p.port}/tcp`, 'comment', ufwComment(p.name)])

  return { directory: f.dir, user, unit: unitName(p.name) }
}

/** Rule numbers tagged for this server, highest first so deleting one does not renumber the rest. */
export function ufwRuleNumbers(statusNumbered: string, name: string): number[] {
  return [...statusNumbered.matchAll(/^\[\s*(\d+)\].*# (.+)$/gm)]
    .filter((m) => m[2]?.trim() === ufwComment(name))
    .map((m) => Number(m[1]))
    .sort((a, b) => b - a)
}

/**
 * Removes a server. The folder is archived to a tarball first, so a mistaken delete can be
 * undone by hand; the panel prunes old archives.
 */
export async function remove(
  p: Params<'server.delete'>,
  ctx: AgentContext,
): Promise<Result<'server.delete'>> {
  const user = userName(p.name)
  const f = paths(ctx, p.name)
  if (!existsSync(f.dir) && !(await userExists(ctx, user))) {
    throw new AgentError('not_found', `no server called ${p.name}`)
  }
  await ctx.exec('systemctl', ['disable', '--now', unitName(p.name)])

  let archivedTo: string | null = null
  if (existsSync(f.dir)) {
    await mkdir(ctx.paths.archive, { recursive: true, mode: 0o700 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    archivedTo = join(ctx.paths.archive, `${p.name}-${stamp}.tar.gz`)
    await run(ctx, 'tar', ['-czf', archivedTo, '-C', ctx.paths.servers, p.name])
    await rm(f.dir, { recursive: true, force: true })
  }

  const status = await ctx.exec('ufw', ['status', 'numbered'])
  for (const n of ufwRuleNumbers(status.stdout, p.name)) {
    await run(ctx, 'ufw', ['--force', 'delete', String(n)])
  }

  await rm(f.env, { force: true })
  await rm(f.dropInDir, { recursive: true, force: true })
  if (await userExists(ctx, user)) await run(ctx, 'userdel', [user])
  await run(ctx, 'systemctl', ['daemon-reload'])
  return { archivedTo }
}
