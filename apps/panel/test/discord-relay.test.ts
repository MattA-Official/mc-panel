import { describe, expect, it } from 'bun:test'
import {
  ChatRelay,
  CONTENT_MAX,
  DIGEST_AT,
  QUEUE_MAX,
  accountName,
  allowedUsername,
  playerPost,
  escapeChat,
  nextPost,
  parseRelayLine,
  waitFromHeaders,
  type Item,
  type Post,
  type RelayConfig,
  type RelayLine,
} from '../server/discord/relay'
import { decodePng, encodePng, HEAD_SIZE, renderHead } from '../server/skins/head'
import { relayView, RelayInput } from '../shared/discord-relay'

// Built from parts so it never looks like a real webhook token.
const WEBHOOK = ['https://discord.com/api/webhooks/123456789', 'not', 'a', 'token'].join('-')

const line = (msg: string) => `[12:34:56] [Server thread/INFO]: ${msg}`
const chat = (player: string, text: string): RelayLine => ({ kind: 'chat', player, text })
const item = (l: RelayLine, avatar: string | null = null): Item => ({ line: l, avatar })

describe('reading the log for chat', () => {
  it('reads chat, unsigned chat and chat turned into system messages', () => {
    expect(parseRelayLine(line('<Steve> hello there'))).toEqual(chat('Steve', 'hello there'))
    expect(parseRelayLine(line('[Not Secure] <Steve> hi'))).toEqual(chat('Steve', 'hi'))
    expect(parseRelayLine(line('System chat: <Steve> hi'))).toEqual(chat('Steve', 'hi'))
    expect(parseRelayLine('[12:34:56 INFO]: <Alex> paper')).toEqual(chat('Alex', 'paper'))
  })

  it('reads /me, joins and leaves', () => {
    expect(parseRelayLine(line('* Steve waves'))).toEqual({
      kind: 'chat',
      player: 'Steve',
      text: 'waves',
      emote: true,
    })
    expect(parseRelayLine(line('System chat: Steve_99 joined the game'))).toEqual({
      kind: 'joined',
      player: 'Steve_99',
    })
    expect(parseRelayLine(line('Steve left the game'))).toEqual({ kind: 'left', player: 'Steve' })
  })

  it('takes the first name, so a player quoting someone else is still themselves', () => {
    expect(parseRelayLine(line('<Bob> <Steve> I am an admin'))).toEqual(
      chat('Bob', '<Steve> I am an admin'),
    )
    expect(parseRelayLine(line('<Bob> Steve joined the game'))).toEqual(
      chat('Bob', 'Steve joined the game'),
    )
  })

  it('ignores everything else', () => {
    expect(parseRelayLine(line('Done (3.2s)! For help, type "help"'))).toBeNull()
    expect(parseRelayLine(line('[Server] hello from the console'))).toBeNull()
    expect(parseRelayLine(line('Steve moved too quickly!'))).toBeNull()
    expect(parseRelayLine('not a log line <Steve> hi')).toBeNull()
  })

  it('finds the account name in a decorated display name', () => {
    expect(accountName('Steve')).toBe('Steve')
    expect(accountName('[Red] Steve')).toBe('Steve')
    expect(accountName('★ ✦')).toBeNull()
  })
})

describe('making chat safe for Discord', () => {
  it('escapes Markdown, mentions, headings and masked links', () => {
    expect(escapeChat('**bold** @everyone <@123> # big')).toBe(
      '\\*\\*bold\\*\\* \\@everyone \\<\\@123\\> \\# big',
    )
    expect(escapeChat('[click](https://evil.example)')).toBe(
      '\\[click\\]\\(<https://evil.example)>',
    )
    expect(escapeChat(':emoji: -# small')).toBe('\\:emoji\\: \\-\\# small')
  })

  it('leaves web addresses whole', () => {
    expect(escapeChat('see https://example.com/a_b-c for it')).toBe(
      'see <https://example.com/a_b-c> for it',
    )
  })

  it('posts chat as the player with mentions off and previews off', () => {
    const p = playerPost([item(chat('Steve', 'hi @here'), 'https://p/heads/x.png')])
    expect(p).toEqual({
      username: 'Steve',
      avatar_url: 'https://p/heads/x.png',
      content: 'hi \\@here',
      allowed_mentions: { parse: [] },
      flags: 4,
    })
  })

  it("puts names Discord won't take in the text instead", () => {
    expect(allowedUsername('DiscordFan')).toBe(false)
    expect(allowedUsername('Steve')).toBe(true)
    const p = playerPost([item(chat('DiscordFan', 'hi'))])
    expect(p.username).toBeUndefined()
    expect(p.content).toBe('**DiscordFan**: hi')
  })

  it('posts joins and leaves as plain text under the player, with their head', () => {
    const p = playerPost([item({ kind: 'joined', player: 'Steve' }, 'https://h')])
    expect(p).toEqual({
      username: 'Steve',
      avatar_url: 'https://h',
      content: '_joined the game_',
      allowed_mentions: { parse: [] },
      flags: 4,
    })
    expect(playerPost([item({ kind: 'left', player: 'DiscordFan' })]).content).toBe(
      '_**DiscordFan** left the game_',
    )
  })
})

describe('joining lines that pile up', () => {
  it("joins one player's lines in a row into one message", () => {
    const q = [item(chat('Steve', 'a')), item(chat('Steve', 'b')), item(chat('Alex', 'c'))]
    const { post, take } = nextPost(q)
    expect(take).toBe(2)
    expect(post.content).toBe('a\nb')
  })

  it("joins a player's join and first words, and stops at the next player", () => {
    const q = [
      item({ kind: 'joined', player: 'Steve' }),
      item(chat('Steve', 'hi')),
      item({ kind: 'left', player: 'Alex' }),
    ]
    const { post, take } = nextPost(q)
    expect(take).toBe(2)
    expect(post.content).toBe('_joined the game_\nhi')
  })

  it('sends a big backlog as one digest', () => {
    const q = Array.from({ length: DIGEST_AT + 3 }, (_, i) => item(chat(`P${i}`, `line ${i}`)))
    q.push(item({ kind: 'left', player: 'P0' }))
    const { post, take } = nextPost(q)
    expect(take).toBe(q.length)
    expect(post.username).toBeUndefined()
    expect(post.content).toContain('**P0**: line 0')
    expect(post.content).toContain('_**P0** left the game_')
  })

  it("keeps a digest within Discord's limit and says what was left out", () => {
    const long = 'x'.repeat(250)
    const q = Array.from({ length: 40 }, () => item(chat('Steve', long)))
    const { post, take } = nextPost(q, 3)
    expect(take).toBeLessThan(40)
    expect(post.content!.length).toBeLessThanOrEqual(CONTENT_MAX)
    expect(post.content).toStartWith('_…3 earlier lines not sent_')
  })

  it("reads Discord's rate-limit headers", () => {
    const empty = new Response(null, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' },
    })
    expect(waitFromHeaders(empty)).toBe(1500)
    const left = new Response(null, {
      headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset-after': '1.5' },
    })
    expect(waitFromHeaders(left)).toBe(0)
    expect(waitFromHeaders(new Response(null))).toBe(0)
  })
})

function relay(
  respond: (n: number) => Response = () => new Response(null, { status: 204 }),
  config: Partial<Omit<RelayConfig, 'url'>> | null = {},
) {
  const posts: Post[] = []
  const sleeps: number[] = []
  const failures: { message: string; permanent: boolean }[] = []
  let clock = 0
  const r = new ChatRelay({
    config: async () =>
      config
        ? { url: WEBHOOK, chat: true, joins: true, deaths: true, advancements: true, ...config }
        : null,
    avatar: async (_server, player) => `https://panel.example/api/public/heads/${player}.png`,
    failed: (_server, message, permanent) => failures.push({ message, permanent }),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    fetch: async (_url, init = {}) => {
      posts.push(JSON.parse(String(init.body)) as Post)
      return respond(posts.length)
    },
  })
  return { r, posts, sleeps, failures }
}

describe('the relay', () => {
  it('posts chat as the player with their head', async () => {
    const { r, posts } = relay()
    r.line('survival', line('<Steve> hello'))
    r.line('survival', line('Done (1s)! For help, type "help"'))
    await Bun.sleep(0)
    await r.idle()
    expect(posts).toHaveLength(1)
    expect(posts[0]!.username).toBe('Steve')
    expect(posts[0]!.avatar_url).toBe('https://panel.example/api/public/heads/Steve.png')
  })

  it('posts nothing for a server without a relay, or for what it leaves out', async () => {
    const none = relay(undefined, null)
    await none.r.offer('survival', chat('Steve', 'hi'))
    await none.r.idle()
    expect(none.posts).toHaveLength(0)

    const chatOnly = relay(undefined, { joins: false })
    await chatOnly.r.offer('survival', { kind: 'joined', player: 'Steve' })
    await chatOnly.r.idle()
    expect(chatOnly.posts).toHaveLength(0)
  })

  it("waits when Discord's bucket is empty", async () => {
    const { r, posts, sleeps } = relay(
      () =>
        new Response(null, {
          status: 204,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '2' },
        }),
    )
    await r.offer('survival', chat('Steve', 'one'))
    await r.offer('survival', chat('Alex', 'two'))
    await r.idle()
    expect(posts.map((p) => p.content)).toEqual(['one', 'two'])
    expect(sleeps).toEqual([2000])
  })

  it('sends the same lines again after a 429, waiting as long as Discord asked', async () => {
    const { r, posts, sleeps, failures } = relay((n) =>
      n === 1
        ? Response.json({ retry_after: 0.75 }, { status: 429 })
        : new Response(null, { status: 204 }),
    )
    await r.offer('survival', chat('Steve', 'hi'))
    await r.idle()
    expect(posts.map((p) => p.content)).toEqual(['hi', 'hi'])
    expect(sleeps).toEqual([750])
    expect(failures).toEqual([])
  })

  it('stops and says so when the webhook is gone', async () => {
    const { r, posts, failures } = relay(() => new Response('Unknown Webhook', { status: 404 }))
    await r.offer('survival', chat('Steve', 'one'))
    await r.offer('survival', chat('Steve', 'two'))
    await r.idle()
    expect(posts).toHaveLength(1)
    expect(failures).toEqual([
      { message: "Discord says that address doesn't exist (404).", permanent: true },
    ])
    expect(r.waiting('survival')).toBe(0)
  })

  it('gives up on a message after a few tries and carries on', async () => {
    const { r, posts, failures } = relay((n) =>
      n <= 3 ? new Response('oops', { status: 502 }) : new Response(null, { status: 204 }),
    )
    await r.offer('survival', chat('Steve', 'lost'))
    await r.idle()
    await r.offer('survival', chat('Steve', 'next'))
    await r.idle()
    expect(posts.map((p) => p.content)).toEqual(['lost', 'lost', 'lost', 'next'])
    expect(failures).toHaveLength(1)
    expect(failures[0]!.permanent).toBe(false)
  })

  it('keeps only the newest lines when far behind', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const posts: Post[] = []
    const r = new ChatRelay({
      config: async () => ({
        url: WEBHOOK,
        chat: true,
        joins: true,
        deaths: true,
        advancements: true,
      }),
      avatar: async () => null,
      failed: () => {},
      fetch: async (_url, init = {}) => {
        posts.push(JSON.parse(String(init.body)) as Post)
        await gate
        return new Response(null, { status: 204 })
      },
    })
    for (let i = 0; i < QUEUE_MAX + 20; i++) await r.offer('survival', chat('Steve', `${i}`))
    expect(r.waiting('survival')).toBe(QUEUE_MAX)
    release()
    await r.idle()
    expect(posts[1]!.content).toContain('earlier lines not sent')
  })
})

describe('player heads', () => {
  /** A 64×64 skin: face pixels red, hat pixels transparent except one blue one. */
  function skin(): Uint8Array {
    const px = new Uint8Array(64 * 64 * 4)
    const set = (x: number, y: number, rgba: number[]) => px.set(rgba, (y * 64 + x) * 4)
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) set(x, y, [200, 0, 0, 255])
    set(40, 8, [0, 0, 255, 255])
    return encodePng(64, 64, px)
  }

  it('draws the face with the hat over it, scaled up sharply', () => {
    const head = decodePng(renderHead(skin()))
    expect(head.width).toBe(HEAD_SIZE)
    const at = (x: number, y: number) => [
      ...head.pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
    ]
    expect(at(0, 0)).toEqual([0, 0, 255, 255])
    expect(at(7, 7)).toEqual([0, 0, 255, 255])
    expect(at(8, 0)).toEqual([200, 0, 0, 255])
    expect(at(63, 63)).toEqual([200, 0, 0, 255])
  })

  it('refuses things that are not skins', () => {
    expect(() => renderHead(new Uint8Array([1, 2, 3]))).toThrow("isn't a PNG")
    expect(() => renderHead(encodePng(16, 16, new Uint8Array(16 * 16 * 4)))).toThrow('size')
  })
})

describe('settings', () => {
  it('never shows the sealed URL', () => {
    const v = relayView({
      urlSealed: 'v1:secret',
      target: 'discord.com/api/webhooks/123/••••',
      chat: true,
      joins: false,
      lastError: null,
      lastErrorAt: null,
      broken: false,
    })
    expect(v).toEqual({
      configured: true,
      target: 'discord.com/api/webhooks/123/••••',
      chat: true,
      joins: false,
      deaths: true,
      advancements: true,
      lastError: null,
      lastErrorAt: null,
      broken: false,
    })
    expect(JSON.stringify(v)).not.toContain('secret')
    expect(relayView(null).configured).toBe(false)
  })

  it('takes a save with or without a new URL', () => {
    expect(RelayInput.parse({ chat: false })).toEqual({
      chat: false,
      joins: true,
      deaths: true,
      advancements: true,
    })
    expect(() => RelayInput.parse({ url: 'nope' })).toThrow()
    expect(() => RelayInput.parse({ url: WEBHOOK, extra: 1 })).toThrow()
  })
})

describe('deaths and advancements', () => {
  it('reads death messages, with or without the system chat prefix', () => {
    expect(parseRelayLine(line('System chat: Steve was slain by Zombie'))).toEqual({
      kind: 'death',
      player: 'Steve',
      text: 'was slain by Zombie',
    })
    expect(parseRelayLine(line('Alex_2 fell from a high place'))).toEqual({
      kind: 'death',
      player: 'Alex_2',
      text: 'fell from a high place',
    })
    expect(
      parseRelayLine(line('System chat: Steve was shot by Skeleton using [Bow of Doom]')),
    ).toEqual({
      kind: 'death',
      player: 'Steve',
      text: 'was shot by Skeleton using [Bow of Doom]',
    })
  })

  it('keeps the whole message when someone else comes first', () => {
    const l = parseRelayLine(line('System chat: Bob showed Steve that not just the floor is lava'))
    expect(l).toEqual({
      kind: 'death',
      player: 'Steve',
      text: 'Bob showed Steve that not just the floor is lava',
      whole: true,
    })
    expect(playerPost([item(l!)]).content).toBe(
      '_Bob showed Steve that not just the floor is lava_',
    )
  })

  it('reads advancements, goals and challenges', () => {
    expect(parseRelayLine(line('System chat: Steve has made the advancement [Stone Age]'))).toEqual(
      {
        kind: 'advancement',
        player: 'Steve',
        text: 'has made the advancement [Stone Age]',
      },
    )
    expect(parseRelayLine(line("Steve has reached the goal [Sky's the Limit]"))?.kind).toBe(
      'advancement',
    )
    expect(parseRelayLine(line('Steve has completed the challenge [Monsters Hunted]'))?.kind).toBe(
      'advancement',
    )
  })

  it("can't be faked from chat", () => {
    expect(parseRelayLine(line('<Bob> Steve was slain by Zombie'))?.kind).toBe('chat')
    expect(parseRelayLine(line('<Bob> Steve has made the advancement [Cheat]'))?.kind).toBe('chat')
    expect(parseRelayLine(line('[Server] Steve was slain by Zombie'))).toBeNull()
  })

  it('posts them in italics under the player, and escapes item names', () => {
    const p = playerPost([
      item(
        { kind: 'advancement', player: 'Steve', text: 'has made the advancement [Stone Age]' },
        'https://h',
      ),
    ])
    expect(p.username).toBe('Steve')
    expect(p.avatar_url).toBe('https://h')
    expect(p.content).toBe('_has made the advancement \\[Stone Age\\]_')
    expect(
      playerPost([item({ kind: 'death', player: 'Steve', text: 'was slain by **@everyone**' })])
        .content,
    ).toBe('_was slain by \\*\\*\\@everyone\\*\\*_')
  })

  it('only posts the kinds that are switched on', async () => {
    const { r, posts } = relay(undefined, { deaths: false })
    await r.offer('survival', { kind: 'death', player: 'Steve', text: 'fell' })
    await r.offer('survival', { kind: 'advancement', player: 'Steve', text: 'has made …' })
    await r.idle()
    expect(posts).toHaveLength(1)
  })
})
