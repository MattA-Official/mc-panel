/**
 * The console's command catalogue for each server: the game's command tree for the server's
 * Minecraft version, plus mod and plugin commands from its `help`.
 *
 * The tree comes from the vanilla server jar's own `--reports`, made once per version the
 * first time a console asks and kept on disk. Making it takes a while (a download and a short
 * Java run), so the first answer can say `building`; the console then asks again with
 * `wait`, which answers when it's done. Nothing is polled.
 *
 * `help` is asked once per run of the server and forgotten when the log says it started or
 * stopped, which also covers content changes, since mods only change on a restart.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Catalogue, CommandNode } from '../../shared/commands'
import { mergeHelp, parseHelp, helpPages, type HelpEntry } from './help'
import { FORMAT, parseReports, type VanillaCommands } from './reports'

export interface CommandsDeps {
  /** Where each version's tree is kept. */
  dir: string
  /** A server's Minecraft version and Java major, or null if there's no such server. */
  server: (name: string) => { minecraft: string; javaMajor: number } | null
  /**
   * Runs the game's reports for a version in `work` and returns the contents of
   * `commands.json` and `registries.json`.
   */
  makeReports: (
    minecraft: string,
    javaMajor: number,
    work: string,
  ) => Promise<{ commands: unknown; registries: unknown }>
  /** Runs a console command without echoing it, or rejects if the console isn't there. */
  command: (name: string, command: string) => Promise<string>
  /** Whether the server is running, and who's on it. */
  online: (name: string) => Promise<{ running: boolean; players: string[] }>
  /** How long after a failed build to try again. */
  retryMs?: number
  now?: () => number
}

export interface CommandsView extends Catalogue {
  /** The game's own tree: there, still being made, or not to be had. */
  vanilla: 'ready' | 'building' | 'unavailable'
  /** Mod and plugin commands from `help`: there, or not (the server is off or not answering). */
  extra: 'ready' | 'unavailable'
}

const SAFE_VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const MAX_PAGES = 30

export class CommandCatalogues {
  private trees = new Map<string, VanillaCommands>()
  private building = new Map<string, Promise<VanillaCommands | null>>()
  private failed = new Map<string, number>()
  private help = new Map<string, Promise<HelpEntry[] | null>>()

  constructor(private deps: CommandsDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)()
  }

  /** The tree for a version if it's been made, starting it otherwise. */
  private vanilla(minecraft: string, javaMajor: number): VanillaCommands | 'building' | null {
    const tree = this.trees.get(minecraft)
    if (tree) return tree
    if (this.building.has(minecraft)) return 'building'
    const failedAt = this.failed.get(minecraft)
    if (failedAt !== undefined && this.now() - failedAt < (this.deps.retryMs ?? 60 * 60_000)) {
      return null
    }
    if (!SAFE_VERSION.test(minecraft)) return null
    const build = this.build(minecraft, javaMajor).then(
      (made) => {
        this.trees.set(minecraft, made)
        this.failed.delete(minecraft)
        return made
      },
      (err) => {
        console.error(`[flytower] couldn't list the commands in Minecraft ${minecraft}`, err)
        this.failed.set(minecraft, this.now())
        return null
      },
    )
    const tracked = build.finally(() => this.building.delete(minecraft))
    this.building.set(minecraft, tracked)
    return 'building'
  }

  private async build(minecraft: string, javaMajor: number): Promise<VanillaCommands> {
    const file = join(this.deps.dir, `${minecraft}.json`)
    if (existsSync(file)) {
      try {
        const kept = JSON.parse(await readFile(file, 'utf8')) as VanillaCommands
        if (kept.format === FORMAT && kept.minecraft === minecraft) return kept
      } catch {
        // Unreadable: make it again.
      }
    }
    await mkdir(this.deps.dir, { recursive: true })
    const work = join(this.deps.dir, `.work-${minecraft}-${process.pid}`)
    await rm(work, { recursive: true, force: true })
    await mkdir(work)
    try {
      const { commands, registries } = await this.deps.makeReports(minecraft, javaMajor, work)
      const made = parseReports(minecraft, commands, registries)
      await writeFile(`${file}.part`, JSON.stringify(made))
      await rename(`${file}.part`, file)
      return made
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  /** Mod and plugin commands, asked once per run of the server. */
  private extra(name: string): Promise<HelpEntry[] | null> {
    let asked = this.help.get(name)
    if (!asked) {
      asked = this.askHelp(name).catch(() => null)
      this.help.set(name, asked)
      // A console that didn't answer is asked again next time.
      void asked.then((entries) => {
        if (!entries && this.help.get(name) === asked) this.help.delete(name)
      })
    }
    return asked
  }

  private async askHelp(name: string): Promise<HelpEntry[]> {
    const first = await this.deps.command(name, 'help')
    const replies = [first]
    const pages = Math.min(helpPages(first), MAX_PAGES)
    for (let page = 2; page <= pages; page++) {
      replies.push(await this.deps.command(name, `help ${page}`))
    }
    return replies.flatMap(parseHelp)
  }

  /** The server started or stopped: its commands may have changed. */
  forgetRun(name: string) {
    this.help.delete(name)
  }

  /**
   * A server's catalogue. With `wait`, a tree still being made is waited for (once it's
   * done, or has failed, the answer comes back).
   */
  async get(name: string, opts: { wait?: boolean } = {}): Promise<CommandsView | null> {
    const server = this.deps.server(name)
    if (!server) return null
    let tree = this.vanilla(server.minecraft, server.javaMajor)
    if (tree === 'building' && opts.wait) {
      tree = (await this.building.get(server.minecraft)) ?? this.trees.get(server.minecraft) ?? null
    }
    const { running, players } = await this.deps.online(name)
    const help = running ? await this.extra(name) : null
    const vanilla = tree === 'building' || tree === null ? null : tree
    const root: CommandNode = help ? mergeHelp(vanilla?.root ?? null, help) : (vanilla?.root ?? {})
    return {
      vanilla: tree === 'building' ? 'building' : tree ? 'ready' : 'unavailable',
      extra: help ? 'ready' : 'unavailable',
      root,
      registries: vanilla?.registries ?? {},
      players,
    }
  }
}
