import { describe, expect, it } from 'bun:test'
import { openDb, schema } from '../server/db'
import { sealer } from '../server/backups/offsite'
import { NotifyService, maskUrl, checkUrl, NotifyError } from '../server/notify'
import { discordPayload, escapeMarkdown, COLOURS, isDiscordWebhook } from '../server/notify/discord'
import { ntfyPayload, splitTopicUrl } from '../server/notify/ntfy'
import { sign, webhookPayload } from '../server/notify/webhook'
import type { Message } from '../server/notify/types'

const DISCORD = 'https://discord.com/api/webhooks/123456789/abcDEF_secret-token'

interface Call {
  url: string
  init: RequestInit
  body: unknown
}

function setup(
  respond: (call: Call, n: number) => Response | Promise<Response> = () =>
    new Response(null, { status: 204 }),
) {
  const db = openDb(':memory:')
  const calls: Call[] = []
  const sleeps: number[] = []
  let clock = Date.parse('2026-11-10T12:00:00Z')
  const seal = sealer(async () => 'ab'.repeat(32))
  const svc = new NotifyService({
    db,
    seal: seal.seal,
    unseal: seal.unseal,
    origin: () => 'https://panel.example.com',
    displayName: (n) => (n === 'survival' ? 'Survival SMP' : null),
    now: () => new Date(clock),
    retryMs: [10, 20, 30],
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async (url, init = {}) => {
      const call = { url, init, body: JSON.parse(String(init.body)) }
      calls.push(call)
      return respond(call, calls.length)
    },
  })
  return {
    db,
    svc,
    calls,
    sleeps,
    tick: (ms: number) => (clock += ms),
  }
}

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'id-1',
  at: new Date('2026-11-10T12:00:00Z'),
  kind: 'backup.failed',
  server: 'survival',
  serverDisplayName: 'Survival SMP',
  title: 'A backup of Survival SMP failed',
  detail: 'Not enough disk space.',
  severity: 'critical',
  url: 'https://panel.example.com/servers/survival/backups',
  ...over,
})

describe('payloads', () => {
  it('builds a Discord embed in the brand colours that pings nobody', () => {
    const p = discordPayload(msg({ detail: '__Steve__ joined @everyone' }))
    expect(p.allowed_mentions).toEqual({ parse: [] })
    const e = p.embeds[0]!
    expect(e.color).toBe(COLOURS.critical)
    expect(e.url).toBe('https://panel.example.com/servers/survival/backups')
    expect(e.description).toBe('\\_\\_Steve\\_\\_ joined @everyone')
    expect(e.footer).toEqual({ text: 'Flytower · Survival SMP' })
    expect(e.timestamp).toBe('2026-11-10T12:00:00.000Z')
  })

  it('recognises Discord webhook addresses', () => {
    expect(isDiscordWebhook(DISCORD)).toBe(true)
    expect(isDiscordWebhook('https://canary.discord.com/api/v10/webhooks/1/x')).toBe(true)
    expect(isDiscordWebhook('https://example.com/api/webhooks/1/x')).toBe(false)
    expect(isDiscordWebhook('http://discord.com/api/webhooks/1/x')).toBe(false)
  })

  it('escapes Discord formatting', () => {
    expect(escapeMarkdown('a*b_c~d`e|f>g[h]')).toBe('a\\*b\\_c\\~d\\`e\\|f\\>g\\[h\\]')
  })

  it('splits an ntfy topic URL and builds its JSON', () => {
    expect(splitTopicUrl('https://ntfy.sh/flytower-alerts')).toEqual({
      server: 'https://ntfy.sh/',
      topic: 'flytower-alerts',
    })
    expect(splitTopicUrl('https://example.com/ntfy/alerts')).toEqual({
      server: 'https://example.com/ntfy/',
      topic: 'alerts',
    })
    expect(() => splitTopicUrl('https://ntfy.sh/')).toThrow(/topic/)
    const p = ntfyPayload(msg(), 'alerts')
    expect(p).toMatchObject({
      topic: 'alerts',
      title: 'A backup of Survival SMP failed (Survival SMP)',
      message: 'Not enough disk space.',
      priority: 5,
      tags: ['rotating_light'],
      click: 'https://panel.example.com/servers/survival/backups',
    })
  })

  it('builds the JSON webhook body and signs it', () => {
    const p = webhookPayload(msg())
    expect(p).toMatchObject({
      version: 1,
      kind: 'backup.failed',
      severity: 'critical',
      server: { name: 'survival', displayName: 'Survival SMP' },
      at: '2026-11-10T12:00:00.000Z',
    })
    const body = JSON.stringify(p)
    const expected = new Bun.CryptoHasher('sha256', 'shh').update(body).digest('hex')
    expect(sign(body, 'shh')).toBe(`sha256=${expected}`)
  })
})

describe('channels', () => {
  it('checks addresses and masks their secret parts', () => {
    expect(() => checkUrl('discord', 'https://example.com/hook')).toThrow(NotifyError)
    expect(() => checkUrl('webhook', 'ftp://example.com')).toThrow(/https/)
    expect(maskUrl('discord', DISCORD)).toBe('discord.com/api/webhooks/123456789/••••')
    expect(maskUrl('ntfy', 'https://ntfy.sh/flytower-alerts')).toBe('ntfy.sh/fly••••')
    expect(maskUrl('webhook', 'https://hooks.example.com/abc/def?x=1')).toBe(
      'https://hooks.example.com/abc…',
    )
  })

  it('seals the URL and secret and never shows them', async () => {
    const { svc, db } = setup()
    const c = await svc.add({
      name: 'Discord',
      kind: 'discord',
      url: DISCORD,
      secret: null,
      events: ['backup.failed'],
      servers: [],
      enabled: true,
    })
    expect(JSON.stringify(c)).not.toContain('secret-token')
    const row = db.select().from(schema.notifyChannels).get()!
    expect(row.urlSealed.startsWith('v1:')).toBe(true)
    expect(row.urlSealed).not.toContain('secret-token')
    await expect(svc.add({ ...c, url: DISCORD, secret: null })).rejects.toThrow(/already a channel/)
  })

  it('keeps the stored URL and secret on edit unless new ones are given', async () => {
    const { svc, calls } = setup()
    const c = await svc.add({
      name: 'Hook',
      kind: 'webhook',
      url: 'https://hooks.example.com/a',
      secret: 'first',
      events: ['backup.failed'],
      servers: [],
      enabled: true,
    })
    const edited = await svc.update(c.id, {
      name: 'Hook 2',
      kind: 'webhook',
      events: ['backup.failed', 'disk.full'],
      servers: ['survival'],
      enabled: true,
    })
    expect(edited).toMatchObject({ name: 'Hook 2', hasSecret: true, servers: ['survival'] })
    await svc.test(
      { name: 'Hook 2', kind: 'webhook', events: [], servers: [], enabled: true },
      c.id,
    )
    expect(calls[0]!.url).toBe('https://hooks.example.com/a')
    const sig = new Headers(calls[0]!.init.headers).get('x-flytower-signature')
    expect(sig).toBe(sign(String(calls[0]!.init.body), 'first'))
    await expect(
      svc.update(c.id, { ...edited, kind: 'discord', secret: undefined }),
    ).rejects.toThrow(/address again/)
  })

  it('only sends a saved secret back to the same kind of channel at the same site', async () => {
    const { svc, calls } = setup()
    const c = await svc.add({
      name: 'Hook',
      kind: 'webhook',
      url: 'https://hooks.example.com/a',
      secret: 'first',
      events: ['backup.failed'],
      servers: [],
      enabled: true,
    })
    const base = { name: 'Hook', events: [], servers: [], enabled: true }
    await expect(
      svc.test({ ...base, kind: 'webhook', url: 'https://elsewhere.example.net/x' }, c.id),
    ).rejects.toThrow(/secret again/)
    await expect(
      svc.test({ ...base, kind: 'ntfy', url: 'https://hooks.example.com/topic' }, c.id),
    ).rejects.toThrow(/secret again/)
    expect(calls).toHaveLength(0)
    // A new path on the same site keeps the secret, and a typed-in one always works.
    await svc.test({ ...base, kind: 'webhook', url: 'https://hooks.example.com/b' }, c.id)
    await svc.test(
      { ...base, kind: 'webhook', url: 'https://elsewhere.example.net/x', secret: 'new' },
      c.id,
    )
    expect(calls.map((x) => x.url)).toEqual([
      'https://hooks.example.com/b',
      'https://elsewhere.example.net/x',
    ])
    const sig = (n: number) => new Headers(calls[n]!.init.headers).get('x-flytower-signature')
    expect(sig(0)).toBe(sign(String(calls[0]!.init.body), 'first'))
    expect(sig(1)).toBe(sign(String(calls[1]!.init.body), 'new'))
  })

  it('reports a failed test plainly', async () => {
    const { svc } = setup(() => new Response('{"message": "Unknown Webhook"}', { status: 404 }))
    await expect(
      svc.test({
        name: 'D',
        kind: 'discord',
        url: DISCORD,
        events: [],
        servers: [],
        enabled: true,
      }),
    ).rejects.toThrow(/doesn't exist/)
  })
})

async function channel(svc: NotifyService, over: Record<string, unknown> = {}) {
  return svc.add({
    name: 'Discord',
    kind: 'discord',
    url: DISCORD,
    secret: null,
    events: ['backup.failed', 'disk.full', 'update.flytower', 'player.joined'],
    servers: [],
    enabled: true,
    ...over,
  })
}

describe('sending', () => {
  it('sends only to channels that want the event and the server', async () => {
    const { svc, calls } = setup()
    await channel(svc)
    await channel(svc, { name: 'Other', servers: ['creative'] })
    await channel(svc, { name: 'Off', enabled: false })
    svc.notify({
      kind: 'player.joined',
      server: 'survival',
      title: 'Steve joined',
      severity: 'info',
    })
    svc.notify({ kind: 'server.started', server: 'survival', title: 'Started', severity: 'info' })
    await svc.idle()
    expect(calls).toHaveLength(1)
    expect((calls[0]!.body as { embeds: { title: string }[] }).embeds[0]!.title).toBe(
      'Steve joined',
    )
  })

  it('keeps a problem quiet for 30 minutes, then says when it clears', async () => {
    const { svc, calls, tick } = setup()
    await channel(svc)
    const failed = {
      kind: 'backup.failed' as const,
      server: 'survival',
      title: 'Backup failed',
      severity: 'critical' as const,
    }
    svc.notify(failed)
    svc.notify(failed)
    tick(10 * 60_000)
    svc.notify(failed)
    await svc.idle()
    expect(calls).toHaveLength(1)
    // Another server's failure isn't held back by this one.
    svc.notify({ ...failed, server: 'creative' })
    tick(31 * 60_000)
    svc.notify(failed)
    await svc.idle()
    expect(calls).toHaveLength(3)

    svc.resolve({
      kind: 'backup.failed',
      server: 'survival',
      title: 'Backups work again',
      severity: 'ok',
    })
    svc.resolve({
      kind: 'backup.failed',
      server: 'survival',
      title: 'Backups work again',
      severity: 'ok',
    })
    await svc.idle()
    expect(calls).toHaveLength(4)
    const embed = (calls[3]!.body as { embeds: { color: number }[] }).embeds[0]!
    expect(embed.color).toBe(COLOURS.ok)
    // Cleared, so the next failure is sent straight away.
    svc.notify(failed)
    await svc.idle()
    expect(calls).toHaveLength(5)
  })

  it('warns about the disk at 85% and 95%, once each, and clears below 80%', async () => {
    const { svc, calls } = setup()
    await channel(svc)
    const titles = () =>
      calls.map((c) => (c.body as { embeds: { title: string }[] }).embeds[0]!.title)
    svc.disk(70, 100)
    svc.disk(86, 100)
    svc.disk(88, 100)
    svc.disk(84, 100) // the margin: not cleared yet
    svc.disk(86, 100)
    svc.disk(96, 100)
    svc.disk(97, 100)
    svc.disk(79, 100)
    svc.disk(79, 100)
    await svc.idle()
    expect(titles()).toEqual([
      'The disk is 85% full',
      'The disk is 95% full',
      'Disk space is back to normal',
    ])
  })

  it('carries over a disk warning sent before it was kept per machine', async () => {
    const { svc, calls } = setup()
    await channel(svc)
    const old = svc as unknown as {
      setState: (key: string, v: { sentAt: Date; open: boolean; value: string }) => void
    }
    old.setState('disk.full:*', { sentAt: new Date(), open: true, value: '85' })
    svc.disk(88, 100)
    await svc.idle()
    expect(calls).toHaveLength(0)
    svc.disk(96, 100)
    await svc.idle()
    expect(calls).toHaveLength(1)
  })

  it('offers each update once', async () => {
    const { svc, calls } = setup()
    await channel(svc)
    const e = {
      kind: 'update.flytower' as const,
      title: 'Flytower 1.1.0 is out',
      severity: 'info' as const,
    }
    svc.offer(e, '1.1.0')
    svc.offer(e, '1.1.0')
    svc.offer({ ...e, title: 'Flytower 1.2.0 is out' }, '1.2.0')
    await svc.idle()
    expect(calls).toHaveLength(2)
  })

  it('retries, honours Discord rate limits, and records the last error', async () => {
    const { svc, calls, sleeps, db } = setup((_c, n) =>
      n === 1
        ? new Response('{"retry_after": 1.5}', { status: 429 })
        : new Response('oops', { status: 500 }),
    )
    await channel(svc)
    svc.notify({
      kind: 'player.joined',
      server: 'survival',
      title: 'Steve joined',
      severity: 'info',
    })
    await svc.idle()
    expect(calls).toHaveLength(4)
    expect(sleeps).toEqual([1500, 20, 30])
    const row = db.select().from(schema.notifyChannels).get()!
    expect(row.lastError).toContain('500')
    expect(row.lastSentAt).toBeNull()
  })

  it("doesn't retry an address that's gone, and clears the error once it works", async () => {
    let gone = true
    const { svc, calls, db } = setup(() =>
      gone ? new Response(null, { status: 404 }) : new Response(null, { status: 204 }),
    )
    await channel(svc)
    const e = {
      kind: 'player.joined' as const,
      server: 'survival',
      title: 'Steve joined',
      severity: 'info' as const,
    }
    svc.notify(e)
    await svc.idle()
    expect(calls).toHaveLength(1)
    expect(db.select().from(schema.notifyChannels).get()!.lastError).toMatch(/404/)
    gone = false
    svc.notify(e)
    await svc.idle()
    const row = db.select().from(schema.notifyChannels).get()!
    expect(row.lastError).toBeNull()
    expect(row.lastSentAt).not.toBeNull()
  })

  it('links back to the panel and names the server', async () => {
    const { svc, calls } = setup()
    await channel(svc)
    svc.notify({
      kind: 'backup.failed',
      server: 'survival',
      title: 'Backup failed',
      severity: 'critical',
      link: '/servers/survival/backups',
    })
    await svc.idle()
    const e = (calls[0]!.body as { embeds: { url: string; footer: { text: string } }[] }).embeds[0]!
    expect(e.url).toBe('https://panel.example.com/servers/survival/backups')
    expect(e.footer.text).toBe('Flytower · Survival SMP')
  })
})

describe('a real HTTP receiver', () => {
  it('gets one signed POST', async () => {
    const got: { headers: Headers; body: string }[] = []
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        got.push({ headers: req.headers, body: await req.text() })
        return new Response('ok')
      },
    })
    const db = openDb(':memory:')
    const seal = sealer(async () => 'cd'.repeat(32))
    const svc = new NotifyService({
      db,
      seal: seal.seal,
      unseal: seal.unseal,
      origin: () => null,
      displayName: () => null,
    })
    await svc.add({
      name: 'Local',
      kind: 'webhook',
      url: `http://127.0.0.1:${server.port}/hook`,
      secret: 'shared-secret',
      events: ['backup.failed'],
      servers: [],
      enabled: true,
    })
    svc.notify({
      kind: 'backup.failed',
      server: 'survival',
      title: 'Backup failed',
      severity: 'critical',
    })
    await svc.idle()
    expect(got).toHaveLength(1)
    expect(got[0]!.headers.get('x-flytower-signature')).toBe(sign(got[0]!.body, 'shared-secret'))
    expect(got[0]!.headers.get('x-flytower-event')).toBe('backup.failed')
    expect(JSON.parse(got[0]!.body)).toMatchObject({ kind: 'backup.failed', link: null })
  })
})
