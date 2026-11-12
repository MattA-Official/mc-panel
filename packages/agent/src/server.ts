import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Socket } from 'bun'
import { encode, lineSplitter } from '@flytower/protocol'
import type { AgentContext } from './context.ts'
import { dispatch, type Handlers } from './dispatch.ts'

export interface ListenOptions {
  socketPath: string
  /** Group allowed to connect (the panel's group). Null skips chown, for tests. */
  group: string | null
}

export interface AgentServer {
  close(): void
}

/** Looks up a group id in /etc/group. */
export function groupId(name: string, groupFile = '/etc/group'): number {
  for (const line of readFileSync(groupFile, 'utf8').split('\n')) {
    const [g, , gid] = line.split(':')
    if (g === name && gid) return Number(gid)
  }
  throw new Error(`group ${name} not found`)
}

interface Conn {
  feed: (chunk: Uint8Array) => void
  queue: Promise<void>
  /** Bytes the kernel has not accepted yet; flushed on drain. */
  pending: Uint8Array
}

const encoder = new TextEncoder()

function send(socket: Socket<Conn>, text: string) {
  const c = socket.data
  const bytes = encoder.encode(text)
  const out = c.pending.length ? new Uint8Array([...c.pending, ...bytes]) : bytes
  const written = socket.write(out)
  c.pending = written < out.length ? out.slice(Math.max(written, 0)) : new Uint8Array()
}

/**
 * Listens on a Unix socket. Access control is the socket's file mode: the directory and
 * socket are root-owned, group = the panel's group, mode 0750/0660, so only root and the
 * panel's group can connect. Servers also carry that group, so their units hide this folder
 * (InaccessiblePaths in units.ts). Bun exposes no SO_PEERCRED, so the filesystem is the check.
 * Requests on one connection are answered strictly in order.
 */
export function listen(
  opts: ListenOptions,
  handlers: Handlers,
  ctx: AgentContext,
): Promise<AgentServer> {
  const dir = dirname(opts.socketPath)
  mkdirSync(dir, { recursive: true, mode: 0o750 })
  if (existsSync(opts.socketPath)) unlinkSync(opts.socketPath)

  const listener = Bun.listen<Conn>({
    unix: opts.socketPath,
    socket: {
      open(socket) {
        socket.timeout(10 * 60)
        socket.data = {
          pending: new Uint8Array(),
          queue: Promise.resolve(),
          feed: lineSplitter(
            (line) => {
              socket.data.queue = socket.data.queue.then(async () => {
                const res = await dispatch(line, handlers, ctx)
                if (socket.readyState === 1) send(socket, encode(res))
              })
            },
            () => socket.end(),
          ),
        }
      },
      data(socket, chunk) {
        socket.data.feed(chunk)
      },
      drain(socket) {
        if (socket.data.pending.length) send(socket, '')
      },
      timeout(socket) {
        socket.end()
      },
      error(socket) {
        socket.end()
      },
    },
  })

  try {
    if (opts.group !== null) {
      const gid = groupId(opts.group)
      chownSync(dir, 0, gid)
      chownSync(opts.socketPath, 0, gid)
      chmodSync(dir, 0o750)
    }
    chmodSync(opts.socketPath, 0o660)
  } catch (err) {
    listener.stop(true)
    return Promise.reject(err)
  }
  return Promise.resolve({ close: () => listener.stop(true) })
}
