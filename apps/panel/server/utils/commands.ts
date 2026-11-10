import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { downloadVerified, Mojang } from '@flytower/providers'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { CommandCatalogues } from '../commands/service'

let catalogues: CommandCatalogues | undefined
let mojang: Mojang | undefined

/** The longest the game's reports may take. They usually take 10 to 30 seconds. */
const REPORTS_TIMEOUT_MS = 3 * 60_000

/** Before 1.18 the server jar isn't a bundler, so the data generator is run directly. */
function bundled(minecraft: string): boolean {
  const m = /^1\.(\d+)(?:\.|$)/.exec(minecraft)
  return !m || Number(m[1]) >= 18
}

/**
 * Runs the vanilla server jar's data generator for its reports, at low priority, with the
 * Java runtime the server already uses. Only the generator runs: no world, no network.
 */
async function makeReports(minecraft: string, javaMajor: number, work: string) {
  const config = useRuntimeConfig()
  const java = join(config.runtimesDir, `temurin-${javaMajor}`, 'bin', 'java')
  if (!existsSync(java)) throw new Error(`Java ${javaMajor} isn't installed.`)
  mojang ??= new Mojang(fetch)
  const jar = await mojang.serverJar(minecraft)
  await downloadVerified(fetch, jar.url, join(work, 'server.jar'), jar.hash)

  const main = bundled(minecraft)
    ? ['-DbundlerMainClass=net.minecraft.data.Main', '-jar', 'server.jar']
    : ['-cp', 'server.jar', 'net.minecraft.data.Main']
  const low = [
    ...(Bun.which('nice') ? ['nice', '-n', '15'] : []),
    ...(Bun.which('ionice') ? ['ionice', '-c', '3'] : []),
  ]
  const proc = Bun.spawn([...low, java, '-Xmx1G', ...main, '--reports', '--output', 'generated'], {
    cwd: work,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), REPORTS_TIMEOUT_MS)
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]).finally(
    () => clearTimeout(timer),
  )
  if (code !== 0) throw new Error(err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`)
  const reports = join(work, 'generated', 'reports')
  return {
    commands: await Bun.file(join(reports, 'commands.json')).json(),
    registries: await Bun.file(join(reports, 'registries.json'))
      .json()
      .catch(() => ({})),
  }
}

/** The console's command catalogues. */
export function useConsoleCommands(): CommandCatalogues {
  if (catalogues) return catalogues
  const config = useRuntimeConfig()
  const c = new CommandCatalogues({
    dir: config.commandsDir,
    server(name) {
      const row = useDb()
        .select({ mc: schema.servers.mcVersion, java: schema.servers.javaMajor })
        .from(schema.servers)
        .where(eq(schema.servers.name, name))
        .get()
      return row ? { minecraft: row.mc, javaMajor: row.java } : null
    },
    makeReports,
    command: (name, command) =>
      useConsole().command(name, command, { echo: false, timeoutMs: 10_000 }),
    async online(name) {
      const running = (await useStatus().current())[name] === 'active'
      const roster = await useRoster().view(name, running)
      return { running, players: roster.players ?? [] }
    },
  })
  // Commands only change when the server restarts (with new mods, or a new version).
  useLogWatcher().listen((server, e) => {
    if (e.kind === 'ready' || e.kind === 'stopping') c.forgetRun(server)
  })
  catalogues = c
  return c
}
