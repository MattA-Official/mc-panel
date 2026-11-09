/**
 * Pretends to be a running Minecraft server for the fake agent: writes believable lines to
 * logs/latest.log and answers RCON on the port and password in server.properties.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TCPSocketListener } from 'bun'
import { encodePacket, PacketParser, PacketType } from '@flytower/rcon'

const stamp = () => new Date().toTimeString().slice(0, 8)
const line = (thread: string, level: string, msg: string) =>
  `[${stamp()}] [${thread}/${level}]: ${msg}\n`

function properties(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
}

const replies: Record<string, (args: string) => string> = {
  list: () => 'There are 0 of a max of 20 players online: ',
  seed: () => 'Seed: [-4172144997902289642]',
  say: () => '',
  help: () => '/advancement\n/ban\n/list\n/say\n/seed\n/stop\n/time\n/weather',
  time: (a) =>
    a.startsWith('query') ? 'The time is 6000' : `Set the time to ${a.split(' ')[1] ?? '0'}`,
}

export async function startFakeMinecraft(dir: string) {
  const log = join(dir, 'logs', 'latest.log')
  await mkdir(join(dir, 'logs'), { recursive: true })
  await writeFile(log, line('main', 'INFO', 'Loading Minecraft 26.3 with Fabric Loader 0.18.4'))
  const props = properties(await readFile(join(dir, 'server.properties'), 'utf8').catch(() => ''))
  const port = Number(props['rcon.port'] ?? 0)
  const password = props['rcon.password'] ?? ''

  const boot = [
    ['Server thread', 'INFO', 'Starting minecraft server version 26.3'],
    ['Server thread', 'INFO', 'Loading properties'],
    ['Server thread', 'INFO', `Starting Minecraft server on *:${props['server-port'] ?? 25565}`],
    ['Server thread', 'WARN', '**** SERVER IS RUNNING IN OFFLINE/INSECURE MODE! (pretend)'],
    ['Server thread', 'INFO', 'Preparing level "world"'],
    ['Server thread', 'INFO', 'Done (3.142s)! For help, type "help"'],
    ['Server thread', 'INFO', `Starting remote control listener`],
    ['Server thread', 'INFO', `RCON running on 0.0.0.0:${port}`],
  ] as const
  for (const [t, l, m] of boot) {
    await Bun.sleep(150)
    await appendFile(log, line(t, l, m))
  }

  let rcon: TCPSocketListener<PacketParser> | null = null
  if (port) {
    rcon = Bun.listen<PacketParser>({
      hostname: '127.0.0.1',
      port,
      socket: {
        open: (s) => void (s.data = new PacketParser()),
        data: (s, chunk) => {
          for (const p of s.data.push(chunk)) {
            if (p.type === PacketType.Auth) {
              s.write(encodePacket(p.body === password ? p.id : -1, PacketType.Command, ''))
            } else if (p.type === PacketType.Command) {
              const [cmd = '', ...rest] = p.body.split(' ')
              const reply = replies[cmd]?.(rest.join(' ')) ?? `Unknown or incomplete command`
              if (cmd === 'say')
                void appendFile(log, line('Server thread', 'INFO', `[Rcon] ${rest.join(' ')}`))
              s.write(encodePacket(p.id, PacketType.Response, reply))
            } else {
              s.write(encodePacket(p.id, PacketType.Response, `Unknown request ${p.type}`))
            }
          }
        },
      },
    })
  }
  const heartbeat = setInterval(
    () => void appendFile(log, line('Server thread', 'INFO', 'Saving the game (autosave)')),
    15_000,
  )
  return {
    async stop() {
      clearInterval(heartbeat)
      rcon?.stop(true)
      await appendFile(log, line('Server thread', 'INFO', 'Stopping the server'))
      await appendFile(log, line('Server thread', 'INFO', 'Saving worlds'))
    },
  }
}
