/**
 * Copying a server folder for a clone. The copy goes to a staging folder; the create job
 * then moves it into the new server, as an import would.
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { folderBytes, type BackupService } from './backups/service'
import { skipped } from './imports/move'
import type { PreparedSource } from './jobs/runner'
import { levelNameOf } from './spec/apply'

async function cp(from: string, to: string) {
  const p = Bun.spawn(['cp', '-a', '--reflink=auto', '--', from, to], { stderr: 'pipe' })
  if ((await p.exited) !== 0) {
    throw new Error(`Copying ${from} failed: ${(await new Response(p.stderr).text()).trim()}`)
  }
}

/**
 * Copies what a new server needs from `src` into `dest`. Without the world, only its
 * datapacks folder comes along, since those are installed content.
 */
export async function copyServerFolder(
  src: string,
  dest: string,
  opts: { withWorld: boolean; levelName: string },
) {
  await mkdir(dest, { recursive: true })
  for (const name of await readdir(src)) {
    if (skipped(name) || name.startsWith('.flytower')) continue
    if (name === opts.levelName && !opts.withWorld) {
      const packs = join(src, name, 'datapacks')
      if ((await stat(packs).catch(() => null))?.isDirectory()) {
        await mkdir(join(dest, name), { recursive: true })
        await cp(packs, join(dest, name, 'datapacks'))
      }
      continue
    }
    await cp(join(src, name), join(dest, name))
  }
}

/** Copies one folder (a world) whole. */
export const copyFolder = cp

export interface CloneDeps {
  serverDir: (name: string) => string
  backups: Pick<BackupService, 'withSavesPaused' | 'lock' | 'ensureSpace'>
  readProperties: (name: string) => Promise<Record<string, string>>
}

/**
 * The copy step of a clone, for the create job: a consistent copy of `from` in `staging`,
 * taken with saving paused, and thrown away once the job is done.
 */
export function cloneSource(
  deps: CloneDeps,
  from: string,
  staging: string,
  opts: { withWorld: boolean },
): PreparedSource {
  return {
    prepare: async () => {
      const release = deps.backups.lock(from)
      try {
        const src = deps.serverDir(from)
        await deps.backups.ensureSpace(dirname(staging), await folderBytes(src))
        const levelName = levelNameOf(await deps.readProperties(from))
        await deps.backups.withSavesPaused(
          from,
          () => {},
          () => copyServerFolder(src, staging, { withWorld: opts.withWorld, levelName }),
        )
      } finally {
        release()
      }
      return { root: staging, kind: 'server' }
    },
    discard: () => rm(staging, { recursive: true, force: true }),
  }
}
