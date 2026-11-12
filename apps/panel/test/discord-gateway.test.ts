import { describe, expect, it } from 'bun:test'
import {
  BACKOFF_MS,
  DEFAULT_GATEWAY,
  Gateway,
  INTENTS,
  type GatewayStatus,
  type SocketLike,
  type Timers,
} from '../server/discord/gateway'
import {
  DiscordToGame,
  PENDING_MAX,
  fromPerson,
  gameCommand,
  gameMessage,
  plainText,
  senderName,
  type DiscordMessage,
} from '../server/discord/to-game'
import { webhookChannel } from '../server/discord/relay'
import { relayView, RelayInput, type InboundView } from '../shared/discord-relay'

// Built from parts so it never looks like a real token.
const TOKEN = ['bot', 'token', 'for', 'tests'].join('-')

class FakeSocket implements SocketLike {
  sent: { op: number; d: unknown }[] = []
  closed: { code?: number; reason?: string } | null = null
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  /** Discord sends a payload. */
  recv(op: number, d: unknown = null, s: number | null = null, t: string | null = null) {
    this.onmessage?.({ data: JSON.stringify({ op, d, s, t }) })
  }
  /** Discord closes the connection. */
  drop(code: number, reason = '') {
    this.onclose?.({ code, reason })
  }
  ops() {
    return this.sent.map((p) => p.op)
  }
}

/** Timers run by hand, in order of when they're due. */
class FakeTimers implements Timers {
  now = 0
  private next = 1
  private due = new Map<number, { at: number; fn: () => void }>()
  set = (fn: () => void, ms: number) => {
    const id = this.next++
    this.due.set(id, { at: this.now + ms, fn })
    return id
  }
  clear = (h: unknown) => {
    this.due.delete(h as number)
  }
  pending() {
    return [...this.due.values()].map((t) => t.at - this.now).sort((a, b) => a - b)
  }
  /** Moves the clock on, running whatever comes due. */
  advance(ms: number) {
    const until = this.now + ms
    for (;;) {
      const first = [...this.due.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!first) break
      this.due.delete(first[0])
      this.now = first[1].at
      first[1].fn()
    }
    this.now = until
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { token?: () => Promise<string>; random?: number } = {}) {
  const sockets: FakeSocket[] = []
  const timers = new FakeTimers()
  const messages: unknown[] = []
  const statuses: GatewayStatus[] = []
  const g = new Gateway({
    token: opts.token ?? (async () => TOKEN),
    gatewayUrl: async () => 'wss://gateway.example',
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    connect: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    timers,
    random: () => opts.random ?? 0.5,
    now: () => timers.now,
  })
  const last = () => sockets.at(-1)!
  /** Hello, then READY. */
  const ready = (sock = last()) => {
    sock.recv(10, { heartbeat_interval: 40_000 })
    sock.recv(
      0,
      {
        session_id: 'sess-1',
        resume_gateway_url: 'wss://resume.example',
        user: { username: 'Flytower' },
        guilds: [{ id: '111111' }],
      },
      1,
      'READY',
    )
  }
  return { g, sockets, timers, messages, statuses, last, ready }
}

describe('the Gateway connection', () => {
  it('identifies with only the intents it needs, and says it is connected', async () => {
    const { g, last, ready } = setup()
    g.start()
    await tick()
    expect(last().url).toBe('wss://gateway.example/?v=10&encoding=json')
    expect(g.status().state).toBe('connecting')
    last().recv(10, { heartbeat_interval: 40_000 })
    const identify = last().sent[0] as { op: number; d: { token: string; intents: number } }
    expect(identify.op).toBe(2)
    expect(identify.d.token).toBe(TOKEN)
    // Guilds, guild messages and message content: nothing else.
    expect(INTENTS).toBe(1 + 512 + 32768)
    expect(identify.d.intents).toBe(INTENTS)
    ready()
    expect(g.status()).toMatchObject({ state: 'connected', bot: 'Flytower', guilds: ['111111'] })
    expect(g.inGuild('111111')).toBe(true)
  })

  it('falls back to Discord’s usual address when it can’t ask for one', async () => {
    const sockets: FakeSocket[] = []
    const g = new Gateway({
      token: async () => TOKEN,
      gatewayUrl: async () => {
        throw new Error('offline')
      },
      onMessage: () => {},
      connect: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s
      },
      timers: new FakeTimers(),
    })
    g.start()
    await tick()
    expect(sockets[0]!.url).toBe(`${DEFAULT_GATEWAY}/?v=10&encoding=json`)
    g.stop()
  })

  it('heartbeats after a random part of the interval, then on the interval', async () => {
    const { g, last, ready, timers } = setup({ random: 0.25 })
    g.start()
    await tick()
    ready()
    expect(timers.pending()).toEqual([10_000])
    timers.advance(10_000)
    expect(last().sent.at(-1)).toEqual({ op: 1, d: 1 })
    last().recv(11)
    last().recv(0, { channel_id: '1' }, 7, 'TYPING_START')
    timers.advance(40_000)
    expect(last().sent.at(-1)).toEqual({ op: 1, d: 7 })
  })

  it('answers Discord’s own heartbeat request at once', async () => {
    const { g, last, ready } = setup()
    g.start()
    await tick()
    ready()
    last().recv(1)
    expect(last().sent.at(-1)).toEqual({ op: 1, d: 1 })
  })

  it('reconnects and resumes when a heartbeat isn’t acknowledged', async () => {
    const { g, sockets, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    timers.advance(20_000) // first heartbeat, never acknowledged
    timers.advance(40_000) // the next one finds it unanswered
    expect(sockets[0]!.closed?.code).toBe(4000)
    await tick()
    expect(sockets).toHaveLength(2)
    expect(last().url).toBe('wss://resume.example/?v=10&encoding=json')
    last().recv(10, { heartbeat_interval: 40_000 })
    expect(last().sent[0]).toEqual({
      op: 6,
      d: { token: TOKEN, session_id: 'sess-1', seq: 1 },
    })
    last().recv(0, null, 2, 'RESUMED')
    expect(g.status().state).toBe('connected')
  })

  it('reconnects and resumes when Discord asks it to', async () => {
    const { g, sockets, last, ready } = setup()
    g.start()
    await tick()
    ready()
    last().recv(7)
    await tick()
    expect(sockets).toHaveLength(2)
    last().recv(10, { heartbeat_interval: 40_000 })
    expect(last().ops()).toEqual([6])
  })

  it('backs off between attempts when the connection drops, and resumes', async () => {
    const { g, sockets, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    last().drop(1006)
    expect(g.status().state).toBe('reconnecting')
    expect(timers.pending()).toEqual([BACKOFF_MS[0]!])
    timers.advance(BACKOFF_MS[0]!)
    await tick()
    last().drop(1006)
    expect(timers.pending()).toEqual([BACKOFF_MS[1]!])
    timers.advance(BACKOFF_MS[1]!)
    await tick()
    expect(sockets).toHaveLength(3)
    last().recv(10, { heartbeat_interval: 40_000 })
    expect(last().ops()).toEqual([6])
    last().recv(0, null, 2, 'RESUMED')
    // Connected again: the next drop starts from the shortest wait.
    last().drop(1006)
    expect(timers.pending()).toEqual([BACKOFF_MS[0]!])
  })

  it('never waits longer than the last step', async () => {
    const { g, last, timers } = setup()
    g.start()
    await tick()
    for (let i = 0; i < BACKOFF_MS.length + 3; i++) {
      last().drop(1006)
      const wait = timers.pending()[0]!
      timers.advance(wait)
      await tick()
    }
    last().drop(1006)
    expect(timers.pending()).toEqual([BACKOFF_MS.at(-1)!])
  })

  it('identifies afresh after a session can’t be resumed', async () => {
    const { g, sockets, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    last().recv(9, false)
    expect(g.status().state).toBe('reconnecting')
    timers.advance(5_000)
    await tick()
    expect(sockets).toHaveLength(2)
    // Back to the main address, not the resume one.
    expect(last().url).toBe('wss://gateway.example/?v=10&encoding=json')
    last().recv(10, { heartbeat_interval: 40_000 })
    expect(last().ops()).toEqual([2])
  })

  it('starts afresh after Discord says the session timed out', async () => {
    const { g, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    last().drop(4009)
    timers.advance(BACKOFF_MS[0]! * 2)
    await tick()
    last().recv(10, { heartbeat_interval: 40_000 })
    expect(last().ops()).toEqual([2])
  })

  it('stops with a reason when the message content intent is off', async () => {
    const { g, sockets, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    last().drop(4014)
    const s = g.status()
    expect(s.state).toBe('stopped')
    expect(s.error).toContain('Message Content Intent')
    expect(timers.pending()).toEqual([])
    timers.advance(120_000)
    await tick()
    expect(sockets).toHaveLength(1)
  })

  it('stops when the token is refused, or there is no token', async () => {
    const a = setup()
    a.g.start()
    await tick()
    a.last().drop(4004)
    expect(a.g.status()).toMatchObject({ state: 'stopped' })
    expect(a.g.status().error).toContain('bot token')

    const b = setup({
      token: async () => {
        throw new Error('No Discord app is connected.')
      },
    })
    b.g.start()
    await tick()
    expect(b.sockets).toHaveLength(0)
    expect(b.g.status()).toMatchObject({ state: 'stopped', error: 'No Discord app is connected.' })
  })

  it('hands over messages, and keeps track of the Discord servers the bot is in', async () => {
    const { g, last, ready, messages } = setup()
    g.start()
    await tick()
    ready()
    last().recv(0, { id: '9', channel_id: '22' }, 2, 'MESSAGE_CREATE')
    expect(messages).toEqual([{ id: '9', channel_id: '22' }])
    last().recv(0, { id: '222222' }, 3, 'GUILD_CREATE')
    expect(g.status().guilds.sort()).toEqual(['111111', '222222'])
    // An outage isn't the bot being removed.
    last().recv(0, { id: '111111', unavailable: true }, 4, 'GUILD_DELETE')
    expect(g.inGuild('111111')).toBe(true)
    last().recv(0, { id: '111111' }, 5, 'GUILD_DELETE')
    expect(g.inGuild('111111')).toBe(false)
  })

  it('closes and does nothing more once stopped', async () => {
    const { g, sockets, last, ready, timers } = setup()
    g.start()
    await tick()
    ready()
    const sock = last()
    g.stop()
    expect(sock.closed?.code).toBe(1000)
    expect(g.status()).toMatchObject({ state: 'off', bot: null, guilds: [] })
    expect(timers.pending()).toEqual([])
    timers.advance(120_000)
    await tick()
    expect(sockets).toHaveLength(1)
  })

  it('ignores a second start while running', async () => {
    const { g, sockets } = setup()
    g.start()
    g.start()
    await tick()
    expect(sockets).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ messages into the game

const msg = (over: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: '1',
  channel_id: '500000',
  guild_id: '111111',
  type: 0,
  content: 'hello',
  author: { id: '42', username: 'steve_', global_name: 'Steve' },
  ...over,
})

describe('which Discord messages come into the game', () => {
  it('takes what people type, and replies', () => {
    expect(fromPerson(msg())).toBe(true)
    expect(fromPerson(msg({ type: 19 }))).toBe(true)
  })

  it('leaves out bots, webhooks (so the relay never echoes), events and direct messages', () => {
    expect(fromPerson(msg({ author: { username: 'bot', bot: true } }))).toBe(false)
    expect(fromPerson(msg({ webhook_id: '777777' }))).toBe(false)
    expect(fromPerson(msg({ type: 7 }))).toBe(false)
    expect(fromPerson(msg({ guild_id: undefined }))).toBe(false)
  })

  it('names the sender as Discord shows them in that server', () => {
    expect(senderName(msg({ member: { nick: 'Stevie' } }))).toBe('Stevie')
    expect(senderName(msg())).toBe('Steve')
    expect(senderName(msg({ author: { username: 'steve_', global_name: null } }))).toBe('steve_')
  })
})

describe('Discord text as plain text', () => {
  it('turns mentions, channels, emoji and times into what people read', () => {
    const m = msg({
      content:
        'hi <@420000> and <@!430000>, see <#900000> <@&800000> <:creeper:123456> </status:9999999>',
      mentions: [
        { id: '420000', username: 'steve_', global_name: 'Steve', member: { nick: 'Stevie' } },
        { id: '430000', username: 'alex' },
      ],
    })
    expect(plainText(m)).toBe('hi @Stevie and @alex, see #channel @role :creeper: /status')
    expect(plainText(msg({ content: 'at <t:0:R>' }))).toBe('at 1970-01-01 00:00 UTC')
  })

  it('takes Markdown out and keeps spoilers hidden', () => {
    expect(plainText(msg({ content: '**bold** *it* __under__ ~~gone~~ `code`' }))).toBe(
      'bold it under gone code',
    )
    expect(plainText(msg({ content: 'the end is ||Steve did it||' }))).toBe('the end is [spoiler]')
    expect(plainText(msg({ content: '> quoted\n# Big' }))).toBe('quoted\nBig')
    expect(plainText(msg({ content: '[the map](https://example.com/map)' }))).toBe('the map')
    expect(plainText(msg({ content: 'my_snake_case stays' }))).toBe('my_snake_case stays')
    expect(plainText(msg({ content: '\\*not italic\\*' }))).toBe('*not italic*')
  })
})

describe('what the game shows', () => {
  it('is cleaned, on one line, and cut to length', () => {
    expect(gameMessage(msg({ content: 'line one\nline two §cred' }))).toBe('line one line two cred')
    expect(gameMessage(msg({ content: 'x'.repeat(2000) }))).toHaveLength(256)
  })

  it('says when someone only sent pictures, files or a sticker', () => {
    const img = { content_type: 'image/png' }
    expect(gameMessage(msg({ content: '', attachments: [img] }))).toBe('[sent an image]')
    expect(gameMessage(msg({ content: '', attachments: [img, img] }))).toBe('[sent 2 images]')
    expect(
      gameMessage(msg({ content: '', attachments: [{ content_type: 'application/zip' }] })),
    ).toBe('[sent a file]')
    expect(gameMessage(msg({ content: '', sticker_items: [{}] }))).toBe('[sent a sticker]')
    expect(gameMessage(msg({ content: '' }))).toBeNull()
  })

  it('is a tellraw that nothing typed can break out of', () => {
    const out = gameCommand(
      msg({ content: '"},{"text":"x","clickEvent":{"action":"run_command","value":"/op Steve"}}' }),
    )!
    expect(out.command.startsWith('tellraw @a ')).toBe(true)
    const json = JSON.parse(out.command.slice('tellraw @a '.length))
    expect(json).toHaveLength(4)
    expect(json[1]).toEqual({ text: '[Discord] ', color: 'blue' })
    expect(json[2]).toEqual({ text: 'Steve: ', color: 'gray' })
    expect(json[3].clickEvent).toBeUndefined()
    expect(out.line).toStartWith('[Discord] Steve: ')
  })
})

describe('handing messages to servers', () => {
  function deps(over: Partial<ConstructorParameters<typeof DiscordToGame>[0]> = {}) {
    const sent: [string, string][] = []
    const shown: [string, string][] = []
    const d = {
      targets: (channel: string) => (channel === '500000' ? ['survival', 'creative'] : []),
      running: async (s: string) => s !== 'creative',
      command: async (s: string, c: string) => {
        sent.push([s, c])
      },
      show: (s: string, l: string) => shown.push([s, l]),
      ...over,
    }
    return { d, sent, shown }
  }

  it('shows a message on each running server linked to the channel', async () => {
    const { d, sent, shown } = deps()
    const t = new DiscordToGame(d)
    t.message(msg())
    t.message(msg({ channel_id: '600000' }))
    await t.idle()
    expect(sent.map(([s]) => s)).toEqual(['survival'])
    expect(shown).toEqual([['survival', '[Discord] Steve: hello']])
  })

  it('keeps order, and drops a flood rather than piling it up', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { d, sent } = deps({
      targets: () => ['survival'],
      command: async (s, c) => {
        await gate
        sent.push([s, c])
      },
    })
    const t = new DiscordToGame(d)
    for (let i = 0; i < PENDING_MAX + 10; i++) t.message(msg({ content: `m${i}` }))
    release()
    await t.idle()
    expect(sent).toHaveLength(PENDING_MAX)
    expect(sent[0]![1]).toContain('"m0"')
    expect(sent.at(-1)![1]).toContain(`"m${PENDING_MAX - 1}"`)
  })

  it('carries on after the game refuses one', async () => {
    let n = 0
    const { d, shown } = deps({
      targets: () => ['survival'],
      command: async () => {
        if (n++ === 0) throw new Error('RCON closed')
      },
    })
    const t = new DiscordToGame(d)
    t.message(msg({ content: 'first' }))
    t.message(msg({ content: 'second' }))
    await t.idle()
    expect(shown).toEqual([['survival', '[Discord] Steve: second']])
  })
})

// ------------------------------------------------------------------ the linked channel

// Built from parts so it never looks like a real webhook token.
const WEBHOOK = ['https://discord.com/api/webhooks/123456789/not', 'a', 'token'].join('-')

describe('the webhook’s channel', () => {
  it('is read from Discord', async () => {
    let asked = ''
    const got = await webhookChannel(WEBHOOK, async (url) => {
      asked = url
      return Response.json({ id: '123456789', channel_id: '500000', guild_id: '111111' })
    })
    expect(asked).toBe(WEBHOOK)
    expect(got).toEqual({ channelId: '500000', guildId: '111111' })
  })

  it('says when the webhook is gone, or isn’t one', async () => {
    const gone = webhookChannel(WEBHOOK, async () => new Response('{}', { status: 404 }))
    expect(gone).rejects.toThrow('doesn’t exist')
    expect(
      webhookChannel('https://example.com/hook', async () => Response.json({})),
    ).rejects.toThrow('webhook address')
    expect(webhookChannel(WEBHOOK, async () => Response.json({ id: '1' }))).rejects.toThrow(
      'which channel',
    )
  })
})

describe('the relay view with chat from Discord', () => {
  const stored = {
    urlSealed: 'sealed',
    target: 'https://discord.com/api/webhooks/123456789/…',
    chat: true,
    joins: true,
    lastError: null,
    lastErrorAt: null,
    broken: false,
  }

  it('is off for relays saved before it existed', () => {
    expect(relayView(stored).fromDiscord).toBe(false)
    expect(RelayInput.parse({}).fromDiscord).toBe(false)
  })

  it('asks how the connection stands for the channel’s Discord server', () => {
    let asked: string | null = 'unset'
    const inbound = (guild: string | null): InboundView => {
      asked = guild
      return { enabled: true, state: 'connected', error: null, botInServer: guild === '111111' }
    }
    const v = relayView({ ...stored, fromDiscord: true, guildId: '111111' }, inbound)
    expect(asked).toBe('111111')
    expect(v.fromDiscord).toBe(true)
    expect(v.inbound.botInServer).toBe(true)
  })
})
