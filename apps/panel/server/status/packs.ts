/**
 * Builds each server's players' pack when it's first asked for after a change, and keeps
 * it on disk until the next one. No background job: the key changes with the lockfile,
 * the extras and the versions, so a stale pack is simply never served.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModrinthPack } from '@flytower/providers'
import type { ClientItem } from '../../shared/public-page'
import type { Lock } from '../spec/lock'
import { writeZip } from '../zip'
import { buildPack, packKey, type PackServer, type PackSummary } from './mrpack'

export interface Pack extends PackSummary {
  /** The .mrpack on disk; null when there's nothing in it for players. */
  path: string | null
}

export class PackStore {
  private built = new Map<string, { key: string; pack: Pack }>()
  private building = new Map<string, Promise<Pack>>()

  constructor(
    private deps: {
      dir: string
      modrinth: ModrinthPack
      readLock: (server: string) => Promise<Lock>
    },
  ) {}

  async get(server: PackServer, extras: ClientItem[]): Promise<Pack> {
    const lock = await this.deps.readLock(server.name)
    const key = packKey(server, lock, extras)
    const have = this.built.get(server.name)
    if (have?.key === key) return have.pack
    const id = `${server.name}:${key}`
    const inFlight = this.building.get(id)
    if (inFlight) return inFlight
    const p = this.build(server, lock, extras, key)
      .then((pack) => {
        this.built.set(server.name, { key, pack })
        return pack
      })
      .finally(() => this.building.delete(id))
    this.building.set(id, p)
    return p
  }

  private async build(server: PackServer, lock: Lock, extras: ClientItem[], key: string) {
    const built = await buildPack({ server, lock, extras, modrinth: this.deps.modrinth })
    const { index, ...summary } = built
    await mkdir(this.deps.dir, { recursive: true })
    await this.clean(server.name, key)
    if (!index.files.length) return { ...summary, path: null }
    const json = join(this.deps.dir, `${server.name}.${key}.json`)
    const path = join(this.deps.dir, `${server.name}.${key}.mrpack`)
    await writeFile(json, JSON.stringify(index, null, 2))
    try {
      const size = Bun.file(json).size
      await writeZip(
        [{ name: 'modrinth.index.json', source: json, size, mtime: new Date(), mode: 0o644 }],
        path,
      )
    } finally {
      await rm(json, { force: true })
    }
    return { ...summary, path }
  }

  /** Removes this server's older packs. */
  private async clean(name: string, keep: string) {
    const files = await readdir(this.deps.dir).catch(() => [] as string[])
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${name}.`) && !f.startsWith(`${name}.${keep}.`))
        .map((f) => rm(join(this.deps.dir, f), { force: true })),
    )
  }

  /** The pack already built for exactly this content, if any, without building. */
  peek(server: PackServer, lock: Lock, extras: ClientItem[]): Pack | undefined {
    const have = this.built.get(server.name)
    return have?.key === packKey(server, lock, extras) ? have.pack : undefined
  }

  forget(name: string) {
    this.built.delete(name)
  }
}
