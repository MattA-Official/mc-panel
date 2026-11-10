/**
 * The connection to a Discord app: the bot token (sealed), the app's ID and public key as
 * Discord reports them, and whether the interactions endpoint is set on the app.
 */
import type { DbOrTx } from '../db'
import { deleteSetting, getSetting, setSetting } from '../settings'
import type { DiscordState } from '../../shared/discord'
import { DiscordApi, DiscordError, type Fetch } from './api'

export { DiscordError }
import { isPublicKey } from './verify'

/** Stored under the `discord.app` setting. */
export interface DiscordApp {
  applicationId: string
  name: string
  publicKey: string
  tokenSealed: string
  endpointSet: boolean
  endpointError: string | null
  connectedAt: string
}

export interface DiscordDeps {
  db: DbOrTx
  seal: (plain: string) => Promise<string>
  unseal: (sealed: string) => Promise<string>
  /** The panel's public origin (https://domain), or null without a domain. */
  origin: () => string | null
  fetch?: Fetch
  now?: () => Date
}

export const INTERACTIONS_PATH = '/api/discord/interactions'

/** Bot tokens are three dot-separated base64url parts. */
const TOKEN = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/

export function inviteUrl(applicationId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=applications.commands`
}

export class DiscordService {
  readonly api: DiscordApi

  constructor(private deps: DiscordDeps) {
    this.api = new DiscordApi(deps.fetch)
  }

  /** The stored app, or null when none is connected. */
  app(): DiscordApp | null {
    return getSetting(this.deps.db, 'discord.app') ?? null
  }

  endpointUrl(): string | null {
    const origin = this.deps.origin()
    return origin ? `${origin}${INTERACTIONS_PATH}` : null
  }

  state(): DiscordState {
    const app = this.app()
    if (!app) return { connected: false, endpointUrl: this.endpointUrl() }
    return {
      connected: true,
      applicationId: app.applicationId,
      name: app.name,
      endpointUrl: this.endpointUrl(),
      endpointSet: app.endpointSet,
      endpointError: app.endpointError,
      inviteUrl: inviteUrl(app.applicationId),
      connectedAt: app.connectedAt,
    }
  }

  async token(): Promise<string> {
    const app = this.app()
    if (!app) throw new DiscordError('No Discord app is connected.')
    try {
      return await this.deps.unseal(app.tokenSealed)
    } catch {
      throw new DiscordError(
        "The stored bot token can't be read; the app secret may have changed. Disconnect and connect again.",
      )
    }
  }

  /**
   * Connects the app the token belongs to: reads it from Discord, saves it, then points its
   * interactions endpoint here. The app is saved first, because Discord checks the endpoint
   * by calling it, and the endpoint needs the public key to answer.
   */
  async connect(rawToken: string): Promise<DiscordState> {
    const token = rawToken.trim().replace(/^Bot\s+/i, '')
    if (!TOKEN.test(token)) {
      throw new DiscordError(
        "That doesn't look like a bot token. Copy it from the Bot tab of your app in Discord's Developer Portal.",
      )
    }
    const me = await this.api.me(token)
    if (!/^\d{5,25}$/.test(me.id) || !isPublicKey(me.verify_key)) {
      throw new DiscordError('Discord sent back an app Flytower doesn’t understand.')
    }
    const app: DiscordApp = {
      applicationId: me.id,
      name: me.name,
      publicKey: me.verify_key.toLowerCase(),
      tokenSealed: await this.deps.seal(token),
      endpointSet: false,
      endpointError: null,
      connectedAt: (this.deps.now?.() ?? new Date()).toISOString(),
    }
    setSetting(this.deps.db, 'discord.app', app)
    await this.pointEndpoint()
    return this.state()
  }

  /** Sets the app's interactions endpoint URL to this panel, and records how that went. */
  async pointEndpoint(): Promise<void> {
    const app = this.app()
    if (!app) return
    const url = this.endpointUrl()
    let endpointSet = false
    let endpointError: string | null = null
    if (!url) {
      endpointError =
        'This panel has no domain, and Discord only talks to https addresses. Give the panel a domain first.'
    } else {
      try {
        await this.api.setEndpoint(await this.token(), url)
        endpointSet = true
      } catch (err) {
        endpointError = (err as Error).message
      }
    }
    // Re-read: a disconnect may have happened while Discord was checking.
    const now = this.app()
    if (now?.applicationId === app.applicationId) {
      setSetting(this.deps.db, 'discord.app', { ...now, endpointSet, endpointError })
    }
  }

  /** Checks the token still works and still belongs to the same app. */
  async test(): Promise<{ name: string }> {
    const app = this.app()
    if (!app) throw new DiscordError('No Discord app is connected.')
    const me = await this.api.me(await this.token())
    if (me.id !== app.applicationId) {
      throw new DiscordError('That token now belongs to a different app. Connect again.')
    }
    const changed = me.verify_key.toLowerCase() !== app.publicKey || me.name !== app.name
    const url = this.endpointUrl()
    const pointsHere = !!url && me.interactions_endpoint_url === url
    if (changed || pointsHere !== app.endpointSet) {
      setSetting(this.deps.db, 'discord.app', {
        ...app,
        name: me.name,
        publicKey: me.verify_key.toLowerCase(),
        endpointSet: pointsHere,
        endpointError: pointsHere
          ? null
          : (app.endpointError ?? 'The app’s interactions endpoint points somewhere else.'),
      })
    }
    return { name: me.name }
  }

  /**
   * Forgets the app. First, as far as Discord lets us, takes its commands down and clears
   * the endpoint, so the app doesn't keep showing commands that can't answer.
   */
  async disconnect(): Promise<{ cleanedUp: boolean }> {
    const app = this.app()
    if (!app) return { cleanedUp: true }
    let cleanedUp = true
    try {
      const token = await this.token()
      await this.api.putCommands(token, app.applicationId, [])
      if (app.endpointSet) await this.api.setEndpoint(token, null)
    } catch {
      cleanedUp = false
    }
    deleteSetting(this.deps.db, 'discord.app')
    return { cleanedUp }
  }
}
