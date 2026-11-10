/**
 * Notifications. The rest of the panel calls `notify()` with a typed event and doesn't know
 * about Discord, ntfy or webhooks. This module picks the channels that want the event, keeps
 * the same alert from repeating within its quiet period, sends a "back to normal" message
 * when a problem clears, and delivers in the background with retries. A failed delivery is
 * recorded on its channel and logged, and never raises another alert.
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema, type Db } from '../db'
import {
  CHANNEL_KINDS,
  EVENT_KINDS,
  type ChannelKind,
  type ChannelView,
  type EventKind,
} from '../../shared/notify'
import { isDiscordWebhook, sendDiscord } from './discord'
import { sendNtfy, splitTopicUrl } from './ntfy'
import { sendWebhook } from './webhook'
import {
  DeliveryError,
  type Destination,
  type Message,
  type NotifyEvent,
  type Sender,
} from './types'

export { DeliveryError, type NotifyEvent } from './types'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>
type Channel = typeof schema.notifyChannels.$inferSelect

export const SENDERS: Record<ChannelKind, Sender> = {
  discord: sendDiscord,
  ntfy: sendNtfy,
  webhook: sendWebhook,
}

/** How long the same problem stays quiet after it's been sent. */
export const QUIET_MS: Partial<Record<EventKind, number>> = {
  'backup.failed': 30 * 60_000,
  'offsite.failed': 30 * 60_000,
  // Quiet only while it's still down; once it's back up, the next crash is sent.
  'server.crashed': 10 * 60_000,
  'server.crash_loop': 30 * 60_000,
  'server.unresponsive': 30 * 60_000,
  'schedule.failed': 30 * 60_000,
}

/** Disk warnings: at 85% and 95%, and back to normal below 80%. */
export const DISK_LEVELS = [85, 95] as const
export const DISK_CLEAR = 80

const RETRY_MS = [5_000, 30_000, 120_000]

export interface NotifyDeps {
  db: Db
  fetch?: Fetch
  seal: (plain: string) => Promise<string>
  unseal: (sealed: string) => Promise<string>
  /** The panel's public address, like https://panel.example.com, for links. */
  origin: () => string | null
  /** A server's display name, or null if there's no such server. */
  displayName: (server: string) => string | null
  /** The install's name and logo (a PNG path, if any), from its branding. */
  brand?: () => { name: string; pngLogo: string | null }
  now?: () => Date
  /** Delays between delivery attempts; tests shorten them. */
  retryMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

export class NotifyError extends Error {}

const Name = z.string().trim().min(1, 'Give it a name.').max(40)
const Url = z.string().trim().url('That isn’t a web address.').max(500)

export const ChannelInput = z.object({
  name: Name,
  kind: z.enum(Object.keys(CHANNEL_KINDS) as [ChannelKind]),
  url: Url,
  /** ntfy token or webhook signing secret. */
  secret: z.string().trim().max(200).nullish(),
  events: z.array(z.enum(Object.keys(EVENT_KINDS) as [EventKind])).max(50),
  servers: z.array(z.string().max(40)).max(200).default([]),
  enabled: z.boolean().default(true),
})
export type ChannelInput = z.infer<typeof ChannelInput>

/** Editing: leave the URL or secret out to keep what's stored; a null secret removes it. */
export const ChannelPatch = ChannelInput.extend({ url: Url.optional() })
export type ChannelPatch = z.infer<typeof ChannelPatch>

/** Checks the URL suits the kind of channel; throws a NotifyError saying what's wrong. */
export function checkUrl(kind: ChannelKind, url: string) {
  if (!/^https?:\/\//i.test(url)) throw new NotifyError('The address should start with https://.')
  if (kind === 'discord' && !isDiscordWebhook(url)) {
    throw new NotifyError(
      'That isn’t a Discord webhook address. In Discord, open the channel’s settings, Integrations, Webhooks, and copy the webhook URL.',
    )
  }
  if (kind === 'ntfy') {
    try {
      splitTopicUrl(url)
    } catch (err) {
      throw new NotifyError((err as Error).message)
    }
  }
}

/** The URL with anything secret hidden: Discord's token, most of an ntfy topic, a path. */
export function maskUrl(kind: ChannelKind, url: string): string {
  const u = new URL(url)
  if (kind === 'discord') {
    const id = u.pathname.split('/').find((p) => /^\d+$/.test(p)) ?? ''
    return `${u.host}/api/webhooks/${id}/••••`
  }
  if (kind === 'ntfy') {
    const { topic } = splitTopicUrl(url)
    return `${u.host}/${topic.slice(0, 3)}••••`
  }
  const first = u.pathname.split('/').filter(Boolean)[0]
  return `${u.protocol}//${u.host}/${first ? `${first.slice(0, 12)}…` : ''}`
}

function view(c: Channel): ChannelView {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    target: c.target,
    hasSecret: !!c.secretSealed,
    events: c.events.filter((e): e is EventKind => Object.hasOwn(EVENT_KINDS, e)),
    servers: c.servers,
    enabled: c.enabled,
    lastSentAt: c.lastSentAt?.toISOString() ?? null,
    lastError: c.lastError,
    lastErrorAt: c.lastErrorAt?.toISOString() ?? null,
  }
}

export class NotifyService {
  private now: () => Date
  private fetch: Fetch
  private retry: number[]
  private sleep: (ms: number) => Promise<void>
  /** One delivery at a time per channel, in order, so Discord's rate limit is respected. */
  private chains = new Map<number, Promise<void>>()

  constructor(private deps: NotifyDeps) {
    this.now = deps.now ?? (() => new Date())
    this.fetch = deps.fetch ?? fetch
    this.retry = deps.retryMs ?? RETRY_MS
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms))
  }

  // ---------------------------------------------------------------- channels

  channels(): ChannelView[] {
    return this.deps.db.select().from(schema.notifyChannels).all().map(view)
  }

  private row(id: number): Channel {
    const c = this.deps.db
      .select()
      .from(schema.notifyChannels)
      .where(eq(schema.notifyChannels.id, id))
      .get()
    if (!c) throw new NotifyError('No such notification channel.')
    return c
  }

  private nameTaken(name: string, except?: number) {
    const other = this.deps.db
      .select({ id: schema.notifyChannels.id })
      .from(schema.notifyChannels)
      .where(eq(schema.notifyChannels.name, name))
      .get()
    return !!other && other.id !== except
  }

  async add(input: ChannelInput): Promise<ChannelView> {
    checkUrl(input.kind, input.url)
    if (this.nameTaken(input.name)) {
      throw new NotifyError(`There's already a channel called ${input.name}.`)
    }
    const row = this.deps.db
      .insert(schema.notifyChannels)
      .values({
        name: input.name,
        kind: input.kind,
        urlSealed: await this.deps.seal(input.url),
        secretSealed: input.secret ? await this.deps.seal(input.secret) : null,
        target: maskUrl(input.kind, input.url),
        events: input.events,
        servers: input.servers,
        enabled: input.enabled,
      })
      .returning()
      .get()
    return view(row)
  }

  async update(id: number, input: ChannelPatch): Promise<ChannelView> {
    const old = this.row(id)
    if (this.nameTaken(input.name, id)) {
      throw new NotifyError(`There's already a channel called ${input.name}.`)
    }
    if (input.kind !== old.kind && !input.url) {
      throw new NotifyError('Enter the address again when changing the kind of channel.')
    }
    const set: Partial<Channel> = {
      name: input.name,
      kind: input.kind,
      events: input.events,
      servers: input.servers,
      enabled: input.enabled,
    }
    if (input.url) {
      checkUrl(input.kind, input.url)
      set.urlSealed = await this.deps.seal(input.url)
      set.target = maskUrl(input.kind, input.url)
      set.lastError = null
      set.lastErrorAt = null
    }
    if (input.secret === null || input.secret === '') set.secretSealed = null
    else if (input.secret) set.secretSealed = await this.deps.seal(input.secret)
    const row = this.deps.db
      .update(schema.notifyChannels)
      .set(set)
      .where(eq(schema.notifyChannels.id, id))
      .returning()
      .get()
    return view(row!)
  }

  remove(id: number): ChannelView {
    const c = this.row(id)
    this.deps.db.delete(schema.notifyChannels).where(eq(schema.notifyChannels.id, id)).run()
    return view(c)
  }

  /** Drops a deleted server from channels that picked it. */
  forgetServer(server: string) {
    for (const c of this.deps.db.select().from(schema.notifyChannels).all()) {
      if (!c.servers.includes(server)) continue
      this.deps.db
        .update(schema.notifyChannels)
        .set({ servers: c.servers.filter((s) => s !== server) })
        .where(eq(schema.notifyChannels.id, c.id))
        .run()
    }
    this.deps.db
      .delete(schema.notifyState)
      .where(eq(schema.notifyState.key, `update.content:${server}`))
      .run()
  }

  /** Whether any enabled channel wants this kind of event, so watchers can stay idle. */
  wants(kind: EventKind): boolean {
    return this.deps.db
      .select({ events: schema.notifyChannels.events, enabled: schema.notifyChannels.enabled })
      .from(schema.notifyChannels)
      .all()
      .some((c) => c.enabled && c.events.includes(kind))
  }

  private async destination(c: Pick<Channel, 'urlSealed' | 'secretSealed'>): Promise<Destination> {
    try {
      return {
        url: await this.deps.unseal(c.urlSealed),
        secret: c.secretSealed ? await this.deps.unseal(c.secretSealed) : null,
      }
    } catch {
      throw new DeliveryError(
        "The stored address can't be read; the app secret may have changed. Edit the channel and enter the address again.",
        null,
        true,
      )
    }
  }

  /**
   * Sends a test message once, straight away, and throws a NotifyError if it fails. Fields
   * left out of an edit (the URL, the secret) come from the saved channel `id`.
   */
  async test(input: ChannelPatch, id?: number): Promise<void> {
    let to: Destination
    if (input.url) {
      checkUrl(input.kind, input.url)
      to = { url: input.url, secret: input.secret || null }
      if (id !== undefined && input.secret === undefined) {
        to.secret = (await this.destination(this.row(id))).secret
      }
    } else if (id !== undefined) {
      const row = this.row(id)
      if (row.kind !== input.kind) {
        throw new NotifyError('Enter the address again when changing the kind of channel.')
      }
      const saved = await this.destination(row)
      to = {
        url: saved.url,
        secret: input.secret === undefined ? saved.secret : input.secret || null,
      }
    } else {
      throw new NotifyError('Enter the address first.')
    }
    const msg = this.message({
      kind: 'test',
      title: 'Test message from Flytower',
      detail: `If you can read this, “${input.name}” is set up. You'll hear about the events you ticked.`,
      severity: 'info',
      link: '/system/notifications',
    })
    try {
      await SENDERS[input.kind](msg, to, this.fetch)
    } catch (err) {
      throw new NotifyError(err instanceof Error ? err.message : String(err))
    }
    // A saved channel that works again shouldn't keep showing its old error.
    if (id !== undefined && !input.url) {
      this.deps.db
        .update(schema.notifyChannels)
        .set({ lastSentAt: this.now(), lastError: null, lastErrorAt: null })
        .where(eq(schema.notifyChannels.id, id))
        .run()
    }
  }

  // ---------------------------------------------------------------- events

  /**
   * Sends an event to every channel that wants it, unless the same problem was sent within
   * its quiet period. Never throws; delivery happens in the background.
   */
  notify(e: NotifyEvent) {
    try {
      if (e.kind !== 'test' && QUIET_MS[e.kind] !== undefined) {
        const key = stateKey(e.kind, e.server)
        const state = this.state(key)
        const quiet = QUIET_MS[e.kind]!
        const nowMs = this.now().getTime()
        if (state && state.open && nowMs - state.sentAt.getTime() < quiet) return
        this.setState(key, { sentAt: this.now(), open: true })
      }
      this.dispatch(e)
    } catch (err) {
      console.error('[flytower] notification failed', err)
    }
  }

  /** Sends a "back to normal" message if this problem was reported and hasn't cleared. */
  resolve(e: NotifyEvent & { kind: EventKind }) {
    try {
      const key = stateKey(e.kind, e.server)
      if (!this.state(key)?.open) return
      this.setState(key, { sentAt: this.now(), open: false })
      this.dispatch({ ...e, severity: 'ok' })
    } catch (err) {
      console.error('[flytower] notification failed', err)
    }
  }

  /**
   * Sends an update notice once per new set of versions. `offer` is what's on offer, like
   * "1.1.0"; the same offer isn't sent twice, and an empty one forgets the last.
   */
  offer(e: NotifyEvent & { kind: 'update.flytower' | 'update.content' }, offer: string) {
    try {
      const key = stateKey(e.kind, e.server)
      const state = this.state(key)
      if ((state?.value ?? '') === offer) return
      this.setState(key, { sentAt: this.now(), open: false, value: offer })
      if (offer) this.dispatch(e)
    } catch (err) {
      console.error('[flytower] notification failed', err)
    }
  }

  /** Warns at 85% and 95% full, once each, and says when it's back below 80%. */
  disk(usedMb: number, totalMb: number) {
    if (!(totalMb > 0)) return
    const pct = (usedMb / totalMb) * 100
    const key = 'disk.full:*'
    const state = this.state(key)
    const warned = state?.open ? Number(state.value) || 0 : 0
    const level = [...DISK_LEVELS].reverse().find((l) => pct >= l) ?? 0
    const free = formatMb(totalMb - usedMb)
    const detail = `${Math.round(pct)}% of the disk is used, with ${free} free. Old backups, exports and archived servers are the usual culprits.`
    if (level > warned) {
      this.setState(key, { sentAt: this.now(), open: true, value: String(level) })
      this.dispatch({
        kind: 'disk.full',
        title: `The disk is ${level}% full`,
        detail,
        severity: level >= 95 ? 'critical' : 'warning',
        link: '/system',
      })
    } else if (warned && pct < DISK_CLEAR) {
      this.setState(key, { sentAt: this.now(), open: false, value: null })
      this.dispatch({
        kind: 'disk.full',
        title: 'Disk space is back to normal',
        detail: `${Math.round(pct)}% of the disk is used, with ${free} free.`,
        severity: 'ok',
        link: '/system',
      })
    } else if (warned >= 95 && pct < 92) {
      // Allow a second 95% warning if it dips well below and climbs again.
      this.setState(key, { sentAt: state!.sentAt, open: true, value: '85' })
    }
  }

  /** Resolves when every delivery started so far has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.chains.size) await Promise.all([...this.chains.values()])
  }

  // ---------------------------------------------------------------- delivery

  private message(e: NotifyEvent): Message {
    const origin = this.deps.origin()?.replace(/\/$/, '') ?? null
    const brand = this.deps.brand?.()
    return {
      ...e,
      id: crypto.randomUUID(),
      at: this.now(),
      serverDisplayName: e.server ? (this.deps.displayName(e.server) ?? e.server) : null,
      url: origin && e.link ? `${origin}${e.link}` : null,
      ...(brand && {
        from: {
          name: brand.name,
          avatarUrl: origin && brand.pngLogo ? `${origin}${brand.pngLogo}` : null,
        },
      }),
    }
  }

  private dispatch(e: NotifyEvent) {
    const channels = this.deps.db
      .select()
      .from(schema.notifyChannels)
      .all()
      .filter(
        (c) =>
          c.enabled &&
          c.events.includes(e.kind) &&
          (!e.server || c.servers.length === 0 || c.servers.includes(e.server)),
      )
    const where = e.server ? ` (${e.server})` : ''
    console.log(
      `[flytower] notification "${e.title}"${where}: ${channels.length ? `sending to ${channels.map((c) => c.name).join(', ')}` : 'no channel wants it'}`,
    )
    if (!channels.length) return
    const msg = this.message(e)
    for (const c of channels) {
      const prev = this.chains.get(c.id) ?? Promise.resolve()
      const next = prev.then(() => this.deliver(c.id, msg))
      this.chains.set(c.id, next)
      void next.finally(() => {
        if (this.chains.get(c.id) === next) this.chains.delete(c.id)
      })
    }
  }

  private async deliver(channelId: number, msg: Message): Promise<void> {
    const { db } = this.deps
    let last: unknown
    for (let attempt = 0; attempt <= this.retry.length; attempt++) {
      // Re-read each time: the channel may have been edited or removed meanwhile.
      const c = db
        .select()
        .from(schema.notifyChannels)
        .where(eq(schema.notifyChannels.id, channelId))
        .get()
      if (!c || !c.enabled) return
      try {
        await SENDERS[c.kind](msg, await this.destination(c), this.fetch)
        db.update(schema.notifyChannels)
          .set({ lastSentAt: this.now(), lastError: null, lastErrorAt: null })
          .where(eq(schema.notifyChannels.id, channelId))
          .run()
        return
      } catch (err) {
        last = err
        const d = err instanceof DeliveryError ? err : null
        if (d?.permanent || attempt === this.retry.length) break
        const wait = Math.max(this.retry[attempt]!, Math.min(d?.retryAfterMs ?? 0, 300_000))
        await this.sleep(wait)
      }
    }
    const message = last instanceof Error ? last.message : String(last)
    console.error(
      `[flytower] couldn't send "${msg.title}" to notification channel ${channelId}: ${message}`,
    )
    db.update(schema.notifyChannels)
      .set({ lastError: message.slice(0, 300), lastErrorAt: this.now() })
      .where(eq(schema.notifyChannels.id, channelId))
      .run()
  }

  // ---------------------------------------------------------------- state

  private state(key: string) {
    return this.deps.db
      .select()
      .from(schema.notifyState)
      .where(eq(schema.notifyState.key, key))
      .get()
  }

  private setState(key: string, v: { sentAt: Date; open: boolean; value?: string | null }) {
    this.deps.db
      .insert(schema.notifyState)
      .values({ key, ...v })
      .onConflictDoUpdate({ target: schema.notifyState.key, set: v })
      .run()
  }
}

export function stateKey(kind: EventKind, server?: string | null) {
  return `${kind}:${server ?? '*'}`
}

function formatMb(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
