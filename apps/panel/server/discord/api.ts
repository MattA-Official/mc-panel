/** The few Discord REST calls Flytower makes, with the bot token. */

export const DISCORD_API = 'https://discord.com/api/v10'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

/** What `GET /applications/@me` tells us about the app. */
export interface DiscordApplication {
  id: string
  name: string
  verify_key: string
  interactions_endpoint_url?: string | null
}

/** Pulls the most useful line out of a Discord error body. */
export function errorText(body: string): string | null {
  try {
    const j = JSON.parse(body) as { message?: string; errors?: unknown }
    // Field errors are nested: { errors: { field: { _errors: [{ message }] } } }.
    const found: string[] = []
    const walk = (v: unknown) => {
      if (!v || typeof v !== 'object') return
      const errs = (v as { _errors?: { message?: string }[] })._errors
      if (Array.isArray(errs)) for (const e of errs) if (e.message) found.push(e.message)
      for (const child of Object.values(v)) walk(child)
    }
    walk(j.errors)
    return found[0] ?? j.message ?? null
  } catch {
    return body.trim().slice(0, 200) || null
  }
}

export class DiscordApi {
  constructor(private fetchImpl: Fetch = (url, init) => fetch(url, init)) {}

  private async call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${DISCORD_API}${path}`, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          'user-agent': 'DiscordBot (https://github.com/MattA-Official/mc-panel, 1)',
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        // Setting the endpoint URL waits while Discord checks it.
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      })
    } catch (err) {
      const e = err as Error
      if (e.name === 'TimeoutError') throw new DiscordError("Discord didn't answer in 20 seconds.")
      throw new DiscordError(`Couldn't reach Discord: ${e.message}`)
    }
    const text = await res.text()
    if (res.status === 401) {
      throw new DiscordError("Discord didn't accept that bot token. Reset it and try again.", 401)
    }
    if (!res.ok) {
      const why = errorText(text)
      throw new DiscordError(`Discord answered ${res.status}${why ? `: ${why}` : ''}`, res.status)
    }
    return (text ? JSON.parse(text) : null) as T
  }

  me(token: string) {
    return this.call<DiscordApplication>(token, 'GET', '/applications/@me')
  }

  /** Discord checks the URL before saving it, by sending it a signed PING. */
  setEndpoint(token: string, url: string | null) {
    return this.call<DiscordApplication>(token, 'PATCH', '/applications/@me', {
      interactions_endpoint_url: url,
    })
  }

  /** Replaces all of the app's global commands with these. */
  putCommands(token: string, applicationId: string, commands: unknown[]) {
    return this.call<unknown[]>(
      token,
      'PUT',
      `/applications/${encodeURIComponent(applicationId)}/commands`,
      commands,
    )
  }

  /**
   * Posts a follow-up message to an interaction. Its token is the credential (valid for 15
   * minutes), so no bot token is sent. Tried once more if Discord hasn't seen the first
   * answer yet.
   */
  async followUp(applicationId: string, interactionToken: string, message: unknown) {
    const url = `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      })
      if (res.ok) return
      const text = await res.text().catch(() => '')
      if (res.status === 404 && attempt === 0) {
        await Bun.sleep(1000)
        continue
      }
      const why = errorText(text)
      throw new DiscordError(`Discord answered ${res.status}${why ? `: ${why}` : ''}`, res.status)
    }
  }
}
