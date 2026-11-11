/**
 * The agent's own folders, outside the panel's data folder so the panel's user can't swap
 * anything in them: the state folder (root only) and the archive of deleted servers (root's,
 * readable by the panel's group). Releases before these kept both inside the panel's folder;
 * what they left there is moved across once. `crates/flytower-agent/src/folders.rs` matches.
 */
import { lstat, open, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentContext } from './context.ts'
import { ownDir, readSmall, writeAtomic } from './safe-fs.ts'

/** Files the state folder holds that are worth keeping across the move. */
const STATE_FILES = ['ssh.json', 'update.json']

/** Archive names server.delete makes; the panel lists the same pattern. */
export const ARCHIVE_NAME = /^[a-z][a-z0-9-]{1,30}-[\dTZ-]+\.tar\.gz$/

async function run(ctx: AgentContext, file: string, args: string[]) {
  const r = await ctx.exec(file, args)
  if (r.code !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr.trim() || 'failed'}`)
}

/** The archive folder, made if need be: the agent's, readable by the panel's group. */
export async function archiveDir(ctx: AgentContext): Promise<string> {
  const dir = ctx.paths.archive
  await ownDir(dir, 0o750)
  // Safe by path: ownDir has just checked nobody else can change this folder.
  await run(ctx, 'chgrp', ['--no-dereference', ctx.panelGroup, dir])
  return dir
}

const isDir = (path: string) =>
  lstat(path).then(
    (s) => s.isDirectory(),
    () => false,
  )

/**
 * Makes the agent's folders and moves in what older releases left in the panel's folder:
 * the SSH timer and the last update record (copied as text, never followed through a link)
 * and the archives of deleted servers (regular files only).
 */
export async function prepareFolders(ctx: AgentContext) {
  await ownDir(ctx.paths.state, 0o700)
  const data = ctx.paths.panelData ?? '/var/lib/flytower'

  const oldState = join(data, 'agent')
  if (resolve(oldState) !== resolve(ctx.paths.state) && (await isDir(oldState))) {
    for (const f of STATE_FILES) {
      const target = join(ctx.paths.state, f)
      const text = await readSmall(join(oldState, f))
      if (text !== null && !(await lstat(target).catch(() => null))) {
        try {
          JSON.parse(text)
          await writeAtomic(target, text)
        } catch {
          // Not JSON: not ours to keep.
        }
      }
      await rm(join(oldState, f), { force: true })
    }
    await rmdir(oldState).catch(() => {})
  }

  const oldArchive = join(data, 'archive')
  if (resolve(oldArchive) !== resolve(ctx.paths.archive) && (await isDir(oldArchive))) {
    const dir = await archiveDir(ctx)
    for (const name of await readdir(oldArchive)) {
      const from = join(oldArchive, name)
      const s = await lstat(from).catch(() => null)
      if (!s?.isFile() || !ARCHIVE_NAME.test(name)) continue
      const to = join(dir, name)
      if (await lstat(to).catch(() => null)) continue
      try {
        await rename(from, to)
      } catch {
        continue // On another disk, say: left where it was.
      }
      // Now in a folder only root can change, so it can be fixed up by path.
      const fh = await open(to, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        await fh.chmod(0o640)
      } finally {
        await fh.close()
      }
      await run(ctx, 'chown', ['--no-dereference', `0:${ctx.panelGroup}`, to])
    }
    await rmdir(oldArchive).catch(() => {})
  }
}
