import { watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { downloadVerified, Mojang } from '@flytower/providers'
import { schema } from '../db'
import { readMapSettings } from '../../shared/map-settings'
import { MapService } from '../map/service'

let service: MapService | undefined
let mojang: Mojang | undefined

/** Where the renderer is: next to Bun in the release's bin/, or wherever FLYTOWER_MAP says. */
export const mapBinary = () =>
  process.env.FLYTOWER_MAP || join(dirname(process.execPath), 'flytower-map')

/** Runs flytower-map at low CPU and disk priority, so the Minecraft servers come first. */
async function runMap(args: string[]): Promise<string> {
  const low = [
    ...(Bun.which('nice') ? ['nice', '-n', '15'] : []),
    ...(Bun.which('ionice') ? ['ionice', '-c', '3'] : []),
  ]
  const proc = Bun.spawn([...low, mapBinary(), ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(err.trim() || `flytower-map exited with ${code}`)
  return out
}

/** The one map service for this process. */
export function useMap(): MapService {
  if (service) return service
  const config = useRuntimeConfig()
  const row = (name: string) =>
    useDb().select().from(schema.servers).where(eq(schema.servers.name, name)).get()
  service = new MapService({
    mapsDir: config.mapsDir,
    serverDir,
    servers: () =>
      useDb()
        .select({ name: schema.servers.name })
        .from(schema.servers)
        .all()
        .map((r) => r.name),
    settings: (name) => {
      const r = row(name)
      return r ? readMapSettings(r.map) : null
    },
    minecraft: (name) => row(name)?.mcVersion ?? null,
    levelName: async (name) => (await readProperties(name))['level-name'] ?? null,
    async makePalette(minecraft, dest) {
      mojang ??= new Mojang(fetch)
      const jar = await mojang.clientJar(minecraft)
      const part = `${dest}.jar.part`
      try {
        await downloadVerified(fetch, jar.url, part, jar.hash)
        await runMap(['palette', '--jar', part, '--out', dest])
      } finally {
        await rm(part, { force: true })
      }
    },
    run: runMap,
    publish: (name, status) => useJobs().bus.publish(`map:${name}`, status),
    watch(dir, onSave) {
      try {
        const watcher = watch(dir, { recursive: true }, (_event, file) => {
          if (typeof file === 'string' && file.endsWith('.mca')) onSave()
        })
        watcher.on('error', (err) => console.error(`[flytower] map watch on ${dir} failed`, err))
        return () => watcher.close()
      } catch (err) {
        console.error(`[flytower] couldn't watch ${dir} for the map`, err)
        return () => {}
      }
    },
  })
  return service
}
