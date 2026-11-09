import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { dirname } from 'node:path'
import { encode, lineSplitter } from '@kiln/protocol'
import type { AgentContext } from './context.ts'
import { dispatch, type Handlers } from './dispatch.ts'

export interface ListenOptions {
  socketPath: string
  /** Group allowed to connect (the panel's group). Null skips chown, for tests. */
  group: string | null
}

/** Looks up a group id in /etc/group. */
export function groupId(name: string, groupFile = '/etc/group'): number {
  for (const line of readFileSync(groupFile, 'utf8').split('\n')) {
    const [g, , gid] = line.split(':')
    if (g === name && gid) return Number(gid)
  }
  throw new Error(`group ${name} not found`)
}

/**
 * Listens on a Unix socket. Access control is the socket's file mode: the directory and
 * socket are root-owned, group = the panel's group, mode 0750/0660, so only root and the
 * panel user can connect. (Node exposes no SO_PEERCRED, so the filesystem is the check.)
 * Requests on one connection are answered strictly in order.
 */
export function listen(
  opts: ListenOptions,
  handlers: Handlers,
  ctx: AgentContext,
): Promise<Server> {
  const dir = dirname(opts.socketPath)
  mkdirSync(dir, { recursive: true, mode: 0o750 })
  if (existsSync(opts.socketPath)) unlinkSync(opts.socketPath)

  const server = createServer((conn) => {
    let queue = Promise.resolve()
    const feed = lineSplitter(
      (line) => {
        queue = queue.then(async () => {
          const res = await dispatch(line, handlers, ctx)
          if (!conn.destroyed) conn.write(encode(res))
        })
      },
      () => conn.destroy(),
    )
    conn.on('data', feed)
    conn.on('error', () => conn.destroy())
    conn.setTimeout(10 * 60_000, () => conn.destroy())
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.socketPath, () => {
      try {
        if (opts.group !== null) {
          const gid = groupId(opts.group)
          chownSync(dir, 0, gid)
          chownSync(opts.socketPath, 0, gid)
          chmodSync(dir, 0o750)
        }
        chmodSync(opts.socketPath, 0o660)
        resolve(server)
      } catch (err) {
        server.close()
        reject(err)
      }
    })
  })
}
