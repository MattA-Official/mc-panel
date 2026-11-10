import type { EventKind, Severity } from '../../shared/notify'

/** Something worth telling people about, as the rest of the panel reports it. */
export interface NotifyEvent {
  kind: EventKind | 'test'
  /** The server it's about, by name; none for machine-wide events. */
  server?: string | null
  title: string
  detail?: string
  severity: Severity
  /** A panel path to open, like `/servers/survival/backups`. */
  link?: string | null
}

/** An event ready to send: with an id, a time, the server's display name and a full link. */
export interface Message extends NotifyEvent {
  id: string
  at: Date
  serverDisplayName: string | null
  url: string | null
  /** Who it's from: the install's name, and its logo's address if Discord can show it. */
  from?: { name: string; avatarUrl: string | null }
}

export interface Destination {
  url: string
  /** ntfy access token, or the webhook's signing secret. */
  secret: string | null
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Sends one message, or throws a DeliveryError. */
export type Sender = (msg: Message, to: Destination, fetchImpl: Fetch) => Promise<void>

export class DeliveryError extends Error {
  constructor(
    message: string,
    /** How long the receiver asked us to wait (HTTP 429). */
    public retryAfterMs: number | null = null,
    /** Retrying won't help, like a deleted Discord webhook. */
    public permanent = false,
  ) {
    super(message)
  }
}

/** Turns a non-2xx answer into a DeliveryError a person can act on. */
export async function failure(res: Response, what: string): Promise<DeliveryError> {
  let body = ''
  try {
    body = (await res.text()).slice(0, 200)
  } catch {
    // The status is enough to go on.
  }
  if (res.status === 429) {
    const header = Number(res.headers.get('retry-after'))
    let after = Number.isFinite(header) && header > 0 ? header * 1000 : null
    try {
      const j = JSON.parse(body) as { retry_after?: number }
      if (typeof j.retry_after === 'number') after = Math.ceil(j.retry_after * 1000)
    } catch {
      // Not JSON: the header is enough.
    }
    return new DeliveryError(`${what} is rate limiting Flytower.`, after ?? 5000)
  }
  if (res.status === 401 || res.status === 403)
    return new DeliveryError(
      `${what} refused the message (${res.status}). Check the token.`,
      null,
      true,
    )
  if (res.status === 404)
    return new DeliveryError(`${what} says that address doesn't exist (404).`, null, true)
  const extra = body.trim() ? `: ${body.trim()}` : ''
  return new DeliveryError(
    `${what} answered ${res.status}${extra}`,
    null,
    res.status >= 400 && res.status < 500,
  )
}

/** Posts JSON, turning network errors into DeliveryErrors. */
export async function postJson(
  fetchImpl: Fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  what = 'The receiver',
): Promise<Response> {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Flytower', ...headers },
      body: text,
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
  } catch (err) {
    const e = err as Error
    if (e.name === 'TimeoutError') throw new DeliveryError(`${what} didn't answer in 15 seconds.`)
    throw new DeliveryError(`Couldn't reach ${what.toLowerCase()}: ${e.message}`)
  }
  if (!res.ok) throw await failure(res, what)
  return res
}

/** What other services need from the notifier, so they don't depend on all of it. */
export interface Notifier {
  notify(e: NotifyEvent): void
  resolve(e: NotifyEvent & { kind: EventKind }): void
}
