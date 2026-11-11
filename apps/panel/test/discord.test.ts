import { describe, expect, it } from 'bun:test'
import { openDb } from '../server/db'
import { sealer } from '../server/backups/offsite'
import { DiscordService, botInviteUrl, inviteUrl } from '../server/discord/service'
import { errorText } from '../server/discord/api'
import { EPHEMERAL, ResponseType } from '../server/discord/interactions'
import { CommandRegistry, route } from '../server/discord/registry'
import { NO_ACCESS } from '../shared/permissions'
import { MAX_SKEW_MS, verifyInteraction } from '../server/discord/verify'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const TS = String(NOW / 1000)

async function keyPair() {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { pair, publicKey: Buffer.from(raw).toString('hex') }
}

async function sign(key: CryptoKey, timestamp: string, body: string) {
  const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(timestamp + body))
  return Buffer.from(new Uint8Array(sig)).toString('hex')
}

describe('interaction signatures', async () => {
  const { pair, publicKey } = await keyPair()
  const body = JSON.stringify({ type: 1, id: '1', application_id: '123', token: 't' })
  const check = (over: Partial<Parameters<typeof verifyInteraction>[0]>) =>
    verifyInteraction({ publicKey, signature: null, timestamp: TS, body, now: NOW, ...over })

  it('accepts a good signature', async () => {
    expect(await check({ signature: await sign(pair.privateKey, TS, body) })).toEqual({ ok: true })
  })

  it('refuses a signature from another key', async () => {
    const other = await keyPair()
    const signature = await sign(other.pair.privateKey, TS, body)
    expect(await check({ signature })).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('refuses a changed body', async () => {
    const signature = await sign(pair.privateKey, TS, body)
    expect(await check({ signature, body: body.replace('"t"', '"u"') })).toMatchObject({
      ok: false,
    })
  })

  it('refuses a stale timestamp, even when signed', async () => {
    const old = String((NOW - MAX_SKEW_MS - 1000) / 1000)
    const signature = await sign(pair.privateKey, old, body)
    expect(await check({ signature, timestamp: old })).toEqual({
      ok: false,
      reason: 'stale timestamp',
    })
    const ahead = String((NOW + MAX_SKEW_MS + 1000) / 1000)
    expect(
      await check({ signature: await sign(pair.privateKey, ahead, body), timestamp: ahead }),
    ).toMatchObject({ ok: false, reason: 'stale timestamp' })
  })

  it('refuses missing and malformed headers', async () => {
    expect(await check({ signature: undefined })).toEqual({ ok: false, reason: 'unsigned' })
    expect(await check({ signature: 'zz'.repeat(64) })).toMatchObject({ ok: false })
    expect(await check({ signature: 'ab' })).toMatchObject({ ok: false })
    const signature = await sign(pair.privateKey, TS, body)
    expect(await check({ signature, timestamp: 'soon' })).toMatchObject({ ok: false })
    expect(await check({ signature, publicKey: 'nope' })).toMatchObject({ ok: false })
  })
})

const answer = (i: Parameters<typeof route>[1]) => route(new CommandRegistry(), i, () => NO_ACCESS)

describe('answering', () => {
  it('answers PING with PONG', async () => {
    expect(await answer({ id: '1', type: 1, application_id: '1', token: 't' })).toEqual({
      type: ResponseType.Pong,
    })
  })

  it('answers an unknown command privately, without pinging anyone', async () => {
    const r = (await answer({
      id: '1',
      type: 2,
      application_id: '1',
      token: 't',
      data: { name: 'nope' },
    })) as {
      data: { flags: number; allowed_mentions: unknown }
    }
    expect(r.data.flags).toBe(EPHEMERAL)
    expect(r.data.allowed_mentions).toEqual({ parse: [] })
  })
})

// Built from parts so secret scanners don't take it for a real token.
const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4OQ', 'GaBcDe', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(
  '.',
)
const PUBLIC_KEY = 'ab'.repeat(32)

interface Call {
  method: string
  url: string
  auth: string | null
  body: unknown
}

function setup(
  respond: (call: Call) => Response = (c) =>
    c.method === 'PUT'
      ? Response.json([])
      : Response.json({
          id: '123456789012345678',
          name: 'Tower Bot',
          verify_key: PUBLIC_KEY,
          interactions_endpoint_url:
            c.method === 'PATCH'
              ? (c.body as { interactions_endpoint_url: string }).interactions_endpoint_url
              : null,
        }),
  origin: string | null = 'https://panel.example.com',
) {
  const db = openDb(':memory:')
  const calls: Call[] = []
  const seal = sealer(async () => 'cd'.repeat(32))
  const svc = new DiscordService({
    db,
    seal: seal.seal,
    unseal: seal.unseal,
    origin: () => origin,
    now: () => new Date(NOW),
    fetch: async (url, init = {}) => {
      const call = {
        method: init.method ?? 'GET',
        url,
        auth: new Headers(init.headers).get('authorization'),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      return respond(call)
    },
  })
  return { svc, calls, db }
}

describe('connecting an app', () => {
  it('reads the app, seals the token and points the endpoint here', async () => {
    const { svc, calls } = setup()
    const state = await svc.connect(`  Bot ${TOKEN} `)
    expect(state).toEqual({
      connected: true,
      applicationId: '123456789012345678',
      name: 'Tower Bot',
      endpointUrl: 'https://panel.example.com/api/discord/interactions',
      endpointSet: true,
      endpointError: null,
      inviteUrl: inviteUrl('123456789012345678'),
      connectedAt: new Date(NOW).toISOString(),
      commands: [],
      commandsError: null,
      botInviteUrl: botInviteUrl('123456789012345678'),
      chat: {
        enabled: false,
        state: 'off',
        error: null,
        since: null,
        guildCount: 0,
        servers: [],
      },
    })
    expect(botInviteUrl('1')).toContain('scope=bot+applications.commands&permissions=1024')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://discord.com/api/v10/applications/@me',
      'PATCH https://discord.com/api/v10/applications/@me',
    ])
    expect(calls[0]!.auth).toBe(`Bot ${TOKEN}`)
    expect(calls[1]!.body).toEqual({
      interactions_endpoint_url: 'https://panel.example.com/api/discord/interactions',
    })
    const app = svc.app()!
    expect(app.publicKey).toBe(PUBLIC_KEY)
    expect(app.tokenSealed).not.toContain(TOKEN)
    expect(await svc.token()).toBe(TOKEN)
  })

  it('keeps the app, with the reason, when Discord won’t take the endpoint', async () => {
    const { svc } = setup((c) =>
      c.method === 'PATCH'
        ? Response.json(
            {
              code: 50035,
              message: 'Invalid Form Body',
              errors: {
                interactions_endpoint_url: {
                  _errors: [
                    {
                      code: 'APPLICATION_INTERACTIONS_ENDPOINT_URL_INVALID',
                      message: 'The specified interactions endpoint url could not be verified.',
                    },
                  ],
                },
              },
            },
            { status: 400 },
          )
        : Response.json({ id: '123456789012345678', name: 'Tower Bot', verify_key: PUBLIC_KEY }),
    )
    const state = await svc.connect(TOKEN)
    expect(state).toMatchObject({
      connected: true,
      endpointSet: false,
      endpointError:
        'Discord answered 400: The specified interactions endpoint url could not be verified.',
    })
  })

  it('says why without a domain, and doesn’t try', async () => {
    const { svc, calls } = setup(undefined, null)
    const state = await svc.connect(TOKEN)
    expect(state).toMatchObject({ connected: true, endpointSet: false, endpointUrl: null })
    expect(calls).toHaveLength(1)
  })

  it('refuses a token Discord doesn’t accept, and stores nothing', async () => {
    const { svc } = setup(() => Response.json({ message: '401: Unauthorized' }, { status: 401 }))
    await expect(svc.connect(TOKEN)).rejects.toThrow("Discord didn't accept that bot token")
    expect(svc.app()).toBeNull()
  })

  it('refuses something that isn’t a token without asking Discord', async () => {
    const { svc, calls } = setup()
    await expect(svc.connect('https://discord.com/api/webhooks/1/abc')).rejects.toThrow(
      "doesn't look like a bot token",
    )
    expect(calls).toHaveLength(0)
  })

  it('tests the connection and notices a moved endpoint', async () => {
    let endpoint: string | null = 'https://panel.example.com/api/discord/interactions'
    const { svc } = setup(() =>
      Response.json({
        id: '123456789012345678',
        name: 'Renamed Bot',
        verify_key: PUBLIC_KEY,
        interactions_endpoint_url: endpoint,
      }),
    )
    await svc.connect(TOKEN)
    expect(await svc.test()).toEqual({ name: 'Renamed Bot' })
    expect(svc.state()).toMatchObject({ name: 'Renamed Bot', endpointSet: true })
    endpoint = 'https://elsewhere.example.com/'
    await svc.test()
    expect(svc.state()).toMatchObject({ endpointSet: false })
  })

  it('disconnects, taking the commands and endpoint down', async () => {
    const { svc, calls } = setup()
    await svc.connect(TOKEN)
    calls.length = 0
    expect(await svc.disconnect()).toEqual({ cleanedUp: true })
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['PUT', []],
      ['PATCH', { interactions_endpoint_url: null }],
    ])
    expect(svc.state()).toEqual({
      connected: false,
      endpointUrl: 'https://panel.example.com/api/discord/interactions',
    })
  })

  it('still forgets the app when Discord can’t be reached', async () => {
    let up = true
    const { svc } = setup((c) => {
      if (!up) throw new TypeError('network down')
      return Response.json({
        id: '123456789012345678',
        name: 'B',
        verify_key: PUBLIC_KEY,
        x: c.url,
      })
    })
    await svc.connect(TOKEN)
    up = false
    expect(await svc.disconnect()).toEqual({ cleanedUp: false })
    expect(svc.app()).toBeNull()
  })
})

describe('Discord error text', () => {
  it('prefers the field error over the summary', () => {
    expect(
      errorText(
        JSON.stringify({
          message: 'Invalid Form Body',
          errors: { a: { _errors: [{ message: 'Nope.' }] } },
        }),
      ),
    ).toBe('Nope.')
    expect(errorText(JSON.stringify({ message: 'Missing Access' }))).toBe('Missing Access')
    expect(errorText('')).toBeNull()
  })
})
