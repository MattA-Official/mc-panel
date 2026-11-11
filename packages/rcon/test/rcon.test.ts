import { afterEach, describe, expect, it } from 'bun:test'
import type { Socket, TCPSocketListener } from 'bun'
import {
  encodePacket,
  PacketParser,
  PacketType,
  Rcon,
  stripFormatting,
  type Packet,
} from '../src/index.ts'

interface FakeOptions {
  password?: string
  /** Reply for a command; long replies are split into 4096-byte packets like Minecraft. */
  reply?: (command: string) => string
  /** Write one byte at a time to exercise reassembly. */
  trickle?: boolean
  /** Never answer commands. */
  silent?: boolean
  /** Wait this long before answering a command (login is answered straight away). */
  delayMs?: number
  /** Handle only the first packet of each read, as Minecraft does. */
  onePacketPerRead?: boolean
}

let server: TCPSocketListener<PacketParser> | null = null
afterEach(() => {
  server?.stop(true)
  server = null
})

/** A stand-in for Minecraft's RCON listener. */
function fakeServer(opts: FakeOptions = {}) {
  const password = opts.password ?? 'secret'
  const received: Packet[] = []
  const send = async (s: Socket<PacketParser>, id: number, type: number, body: string) => {
    const bytes = encodePacket(id, type, body)
    if (!opts.trickle) return void s.write(bytes)
    for (const b of bytes) {
      s.write(new Uint8Array([b]))
      await Bun.sleep(0)
    }
  }
  server = Bun.listen<PacketParser>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open: (s) => void (s.data = new PacketParser()),
      data: async (s, chunk) => {
        const packets = s.data.push(chunk)
        for (const p of opts.onePacketPerRead ? packets.slice(0, 1) : packets) {
          received.push(p)
          if (p.type === PacketType.Auth) {
            await send(s, p.body === password ? p.id : -1, PacketType.Command, '')
          } else if (opts.silent) {
            continue
          } else if (p.type === PacketType.Command) {
            if (opts.delayMs) await Bun.sleep(opts.delayMs)
            const body = opts.reply?.(p.body) ?? `ran ${p.body}`
            for (let i = 0; i === 0 || i < body.length; i += 4096) {
              await send(s, p.id, PacketType.Response, body.slice(i, i + 4096))
            }
          } else {
            await send(s, p.id, PacketType.Response, `Unknown request ${p.type.toString(16)}`)
          }
        }
      },
    },
  })
  return { port: server.port, received }
}

describe('PacketParser', () => {
  it('handles several packets in one chunk and one packet over many', () => {
    const a = encodePacket(1, 0, 'hello')
    const b = encodePacket(2, 0, 'wörld')
    const both = new Uint8Array([...a, ...b])
    const parser = new PacketParser()
    expect(parser.push(both).map((p) => p.body)).toEqual(['hello', 'wörld'])
    const out = [...b].flatMap((byte) => parser.push(new Uint8Array([byte])))
    expect(out).toEqual([{ id: 2, type: 0, body: 'wörld' }])
  })

  it('rejects nonsense lengths', () => {
    expect(() => new PacketParser().push(new Uint8Array([1, 0, 0, 0]))).toThrow('bad RCON')
  })
})

describe('Rcon', () => {
  it('logs in and runs a command', async () => {
    const { port } = fakeServer()
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    expect(await rcon.command('list')).toBe('ran list')
    rcon.close()
  })

  it('refuses a wrong password', async () => {
    const { port } = fakeServer()
    await expect(Rcon.connect({ host: '127.0.0.1', port, password: 'nope' })).rejects.toThrow(
      'The RCON password was refused.',
    )
  })

  it('joins a reply split over several packets', async () => {
    const long = 'x'.repeat(4096) + 'y'.repeat(4096) + 'z'.repeat(100)
    const { port } = fakeServer({ reply: () => long })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    expect(await rcon.command('help')).toBe(long)
    rcon.close()
  })

  it('finishes a reply that is an exact multiple of 4096 characters', async () => {
    const exact = 'q'.repeat(8192)
    const { port } = fakeServer({ reply: () => exact })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    expect(await rcon.command('help')).toBe(exact)
    rcon.close()
  })

  it('never sends a second packet before the first reply is complete', async () => {
    // Like Minecraft: anything after the first packet in one read is lost.
    const { port, received } = fakeServer({ onePacketPerRead: true })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    expect(await Promise.all(['a', 'b'].map((c) => rcon.command(c)))).toEqual(['ran a', 'ran b'])
    expect(received.map((p) => p.type)).toEqual([3, 2, 2])
    rcon.close()
  })

  it('copes with replies arriving a byte at a time', async () => {
    const { port } = fakeServer({ trickle: true })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    expect(await rcon.command('seed')).toBe('ran seed')
    rcon.close()
  })

  it('keeps queued commands from interleaving', async () => {
    const { port, received } = fakeServer({ reply: (c) => `${c}:`.repeat(3000) })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    const replies = await Promise.all(['a', 'b', 'c'].map((c) => rcon.command(c)))
    expect(replies).toEqual(['a', 'b', 'c'].map((c) => `${c}:`.repeat(3000)))
    // One packet per command, never more than one in flight.
    expect(received.slice(1).map((p) => p.type)).toEqual([2, 2, 2])
    rcon.close()
  })

  it('times out and closes when the server goes quiet', async () => {
    const { port } = fakeServer({ silent: true })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret', timeoutMs: 50 })
    await expect(rcon.command('list')).rejects.toThrow('took too long')
    await Bun.sleep(80)
    await expect(rcon.isOpen).toBe(false)
    await expect(rcon.command('list')).rejects.toThrow('closed')
  })

  it('lets one slow command wait longer than the default', async () => {
    // Login is answered at once, so the short default only has to cover it; the command's
    // answer comes later than that default, and only the override leaves time for it.
    const { port } = fakeServer({ reply: () => 'Saved the game', delayMs: 300 })
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret', timeoutMs: 100 })
    expect(await rcon.command('save-all flush', { timeoutMs: 2000 })).toBe('Saved the game')
    rcon.close()
  })

  it('says when nothing is listening', async () => {
    await expect(Rcon.connect({ host: '127.0.0.1', port: 1, password: 'x' })).rejects.toThrow(
      "Couldn't connect to RCON on port 1",
    )
  })

  it('refuses over-long commands', async () => {
    const { port } = fakeServer()
    const rcon = await Rcon.connect({ host: '127.0.0.1', port, password: 'secret' })
    await expect(rcon.command('say ' + 'a'.repeat(2000))).rejects.toThrow('too long')
    rcon.close()
  })
})

it('strips § formatting codes', () => {
  expect(stripFormatting('§6There are §c2§r players')).toBe('There are 2 players')
  // Paper's hex colours: §x then six §-prefixed digits.
  expect(stripFormatting('§x§f§f§0§0§0§0Chunky')).toBe('Chunky')
})
