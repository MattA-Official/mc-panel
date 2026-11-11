import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError, unitName, userName, type Params, type Result } from '@flytower/protocol'
import type { AgentContext } from '../context.ts'
import { archiveDir } from '../folders.ts'
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

/**
 * Brings the systemd template up to date when the agent starts, so servers made by an older
 * version pick up changes such as the crash-loop limit. Only if a server exists (the
 * template does) and it differs. `daemon-reload` doesn't restart running servers; the new
 * settings apply from their next start or crash.
 */
export async function refreshTemplate(ctx: AgentContext): Promise<boolean> {
  const file = join(ctx.paths.systemd, 'flytower-mc@.service')
  const current = await readFile(file, 'utf8').catch(() => null)
  const wanted = templateUnit(ctx)
  if (current === null || current === wanted) return false
  await writeFile(file, wanted, { mode: 0o644 })
  await run(ctx, 'systemctl', ['daemon-reload'])
  return true
}

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

/**
 * Changes a server's memory, Java and/or port. Memory and Java rewrite the env file (memory
 * also the MemoryMax drop-in); port swaps the firewall rule. All take effect on the next
 * restart.
 */
export async function configure(
  p: Params<'server.configure'>,
  ctx: AgentContext,
): Promise<Result<'server.configure'>> {
  const f = paths(ctx, p.name)
  if (!existsSync(f.env)) throw new AgentError('not_found', `no server called ${p.name}`)

  if (p.memoryMb !== undefined || p.javaMajor !== undefined) {
    const env = await readFile(f.env, 'utf8')
    let javaHome = env.match(/^JAVA_HOME=(.+)$/m)?.[1]
    const heapMb = p.memoryMb ?? Number(env.match(/^HEAP_MB=(\d+)$/m)?.[1])
    if (p.javaMajor !== undefined) {
      javaHome = join(ctx.paths.runtimes, `temurin-${p.javaMajor}`)
      if (!existsSync(join(javaHome, 'bin', 'java'))) {
        throw new AgentError(
          'failed',
          `Java ${p.javaMajor} is not installed; run runtime.install first`,
        )
      }
    }
    if (!javaHome) throw new AgentError('failed', `${f.env} has no JAVA_HOME`)
    if (!heapMb) throw new AgentError('failed', `${f.env} has no HEAP_MB`)
    await writeFile(f.env, envFile(javaHome, heapMb), { mode: 0o644 })
    if (p.memoryMb !== undefined) {
      await mkdir(f.dropInDir, { recursive: true, mode: 0o755 })
      await writeFile(join(f.dropInDir, 'limits.conf'), limitsDropIn(p.memoryMb), {
        mode: 0o644,
      })
      await run(ctx, 'systemctl', ['daemon-reload'])
    }
  }

  if (p.port !== undefined) {
    const status = await ctx.exec('ufw', ['status', 'numbered'])
    for (const n of ufwRuleNumbers(status.stdout, p.name)) {
      await run(ctx, 'ufw', ['--force', 'delete', String(n)])
    }
    await run(ctx, 'ufw', ['allow', `${p.port}/tcp`, 'comment', ufwComment(p.name)])
  }
  return {}
}

/**
 * Restores group access across a server folder (owner stays the server's user). Symlinks
 * are not followed: chmod -R on Linux changes the link's target only on the command line.
 */
export async function permissions(
  p: Params<'server.permissions'>,
  ctx: AgentContext,
): Promise<Result<'server.permissions'>> {
  const f = paths(ctx, p.name)
  if (!existsSync(f.dir)) throw new AgentError('not_found', `no server called ${p.name}`)
  await run(ctx, 'chgrp', ['-R', '--no-dereference', ctx.panelGroup, f.dir])
  await run(ctx, 'chmod', ['-R', 'g+rwX,o-rwx', f.dir])
  return {}
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
    // Readable by the panel's group, so a deleted server can be imported again. Only root
    // can change the folder, so the tarball's path can't be swapped for a link.
    const archive = await archiveDir(ctx)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    archivedTo = join(archive, `${p.name}-${stamp}.tar.gz`)
    await run(ctx, 'tar', ['-czf', archivedTo, '-C', ctx.paths.servers, p.name])
    await run(ctx, 'chgrp', [ctx.panelGroup, archivedTo])
    await run(ctx, 'chmod', ['0640', archivedTo])
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
