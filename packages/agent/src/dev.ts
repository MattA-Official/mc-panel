/**
 * A stand-in agent for working on the panel without root or systemd. It answers every verb
 * from memory: services take two seconds to start or stop, Java "installs" instantly, and
 * server folders are made under the dev data directory. Started servers write a log and
 * answer RCON (see dev-minecraft.ts). Never shipped.
 *
 *   bun run --filter @flytower/agent dev
 */
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { unitName, userName } from '@flytower/protocol'
import type { AgentContext } from './context.ts'
import { protocolInfo, type Handlers } from './dispatch.ts'
import { startFakeMinecraft } from './dev-minecraft.ts'
import { listen } from './server.ts'

type State = 'active' | 'inactive' | 'activating' | 'deactivating' | 'failed'

const root = resolve(process.env.FLYTOWER_DEV_DIR ?? '../../apps/panel/.data')
const socketPath = process.env.FLYTOWER_AGENT_SOCKET ?? join(root, 'agent.sock')
const serversDir = join(root, 'servers')
const states = new Map<string, State>()
const TRANSITION_MS = 2000

const running = new Map<string, Awaited<ReturnType<typeof startFakeMinecraft>>>()

function move(server: string, via: State, to: State) {
  states.set(server, via)
  setTimeout(() => states.set(server, to), TRANSITION_MS)
}

async function boot(server: string) {
  await running.get(server)?.stop()
  running.set(server, await startFakeMinecraft(join(serversDir, server)))
}

async function halt(server: string) {
  await running.get(server)?.stop()
  running.delete(server)
}

// Pretend SSH firewall state.
const ssh: { open: boolean; closesAt: Date | null; timer?: ReturnType<typeof setTimeout> } = {
  open: true,
  closesAt: null,
}
const sshState = () => ({
  open: ssh.open,
  ports: [22],
  closesAt: ssh.closesAt?.toISOString() ?? null,
  firewall: true,
})

const handlers: Handlers = {
  ping: async (_p, ctx) => protocolInfo(ctx.version),
  'service.status': async ({ server }) => ({
    active: states.get(server) ?? 'inactive',
    since: null,
  }),
  'service.start': async ({ server }) => {
    move(server, 'activating', 'active')
    void boot(server)
    return {}
  },
  'service.stop': async ({ server }) => {
    move(server, 'deactivating', 'inactive')
    void halt(server)
    return {}
  },
  'service.restart': async ({ server }) => {
    move(server, 'activating', 'active')
    void halt(server).then(() => boot(server))
    return {}
  },
  'runtime.install': async ({ major }) => ({
    javaHome: `/opt/flytower/runtimes/temurin-${major}`,
    version: `${major}.0.0`,
    alreadyInstalled: true,
  }),
  'server.create': async ({ name }) => {
    const directory = join(serversDir, name)
    await mkdir(directory, { recursive: true })
    states.set(name, 'inactive')
    return { directory, user: userName(name), unit: unitName(name) }
  },
  'server.configure': async () => ({}),
  'server.permissions': async () => ({}),
  'ssh.status': async () => sshState(),
  'ssh.set': async (p: { open: boolean; minutes?: number }) => {
    clearTimeout(ssh.timer)
    ssh.open = p.open
    ssh.closesAt = p.open && p.minutes ? new Date(Date.now() + p.minutes * 60_000) : null
    if (ssh.closesAt) {
      ssh.timer = setTimeout(() => ((ssh.open = false), (ssh.closesAt = null)), p.minutes! * 60_000)
    }
    return sshState()
  },
  'server.delete': async ({ name }) => {
    await rm(join(serversDir, name), { recursive: true, force: true })
    states.delete(name)
    return { archivedTo: null }
  },
}

const ctx = {
  version: '0.0.0-dev-fake',
  log: (e: unknown) => console.log(JSON.stringify(e)),
} as unknown as AgentContext

await mkdir(root, { recursive: true })
await listen({ socketPath, group: null }, handlers, ctx)
console.log(`fake agent listening on ${socketPath}`)
