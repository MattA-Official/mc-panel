import { schema } from '../db'
import { getSetting, setSetting } from '../settings'
import { DISCORD_API } from '../discord/api'
import { Gateway } from '../discord/gateway'
import { DiscordToGame } from '../discord/to-game'
import type { DiscordChatState } from '../../shared/discord'
import type { InboundView } from '../../shared/discord-relay'

let gateway: Gateway | undefined
let toGame: DiscordToGame | undefined

/** Chat from Discord into the game: what the Gateway hands over goes to each linked server. */
export function useDiscordToGame(): DiscordToGame {
  toGame ??= new DiscordToGame({
    targets: serversFromChannel,
    running: async (name) => (await useStatus().current())[name] === 'active',
    command: (name, command) => useConsole().command(name, command, { echo: false }),
    show: (name, line) => useConsole().show(name, [line]),
    log: (m) => console.warn(m),
  })
  return toGame
}

/** Where to connect, as Discord recommends asking for it. */
async function gatewayUrl(token: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/gateway/bot`, {
    headers: { authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`Discord answered ${res.status}`)
  const body = (await res.json()) as { url?: string }
  if (!body.url?.startsWith('wss://')) throw new Error('No Gateway address')
  return body.url
}

/** The one Gateway connection for this process. Opened only by `syncDiscordGateway`. */
export function useDiscordGateway(): Gateway {
  gateway ??= new Gateway({
    token: () => useDiscord().token(),
    gatewayUrl,
    onMessage: (m) => useDiscordToGame().message(m),
    log: (m) => console.warn(m),
  })
  return gateway
}

export function discordChatEnabled(): boolean {
  return getSetting(useDb(), 'discord.chat')?.enabled === true
}

/**
 * Opens or closes the Gateway to match the setting: open while chat from Discord is on and an
 * app is connected, closed otherwise. Nothing runs when the setting is off.
 */
export function syncDiscordGateway() {
  const g = useDiscordGateway()
  if (discordChatEnabled() && useDiscord().app()) g.start()
  else g.stop()
}

/** Turns chat from Discord on or off for the whole panel. On again after a stop reconnects. */
export function setDiscordChat(enabled: boolean) {
  setSetting(useDb(), 'discord.chat', { enabled })
  if (enabled) useDiscordGateway().stop()
  syncDiscordGateway()
}

/** How chat from Discord stands for a server's channel, for its Discord chat card. */
export function discordInbound(guildId: string | null): InboundView {
  const enabled = discordChatEnabled()
  const s = gateway?.status()
  const state = enabled ? (s?.state ?? 'off') : 'off'
  return {
    enabled,
    state,
    error: enabled ? (s?.error ?? null) : null,
    botInServer: state === 'connected' && guildId ? s!.guilds.includes(guildId) : null,
  }
}

/** Chat from Discord as the Discord card shows it. */
export function discordChatState(): DiscordChatState {
  const enabled = discordChatEnabled()
  const s = gateway?.status()
  const servers = useDb()
    .select({ displayName: schema.servers.displayName, r: schema.servers.discordRelay })
    .from(schema.servers)
    .all()
    .filter((row) => row.r?.fromDiscord === true)
    .map((row) => row.displayName)
    .sort((a, b) => a.localeCompare(b))
  return {
    enabled,
    state: enabled ? (s?.state ?? 'off') : 'off',
    error: enabled ? (s?.error ?? null) : null,
    since: enabled && s?.since ? new Date(s.since).toISOString() : null,
    guildCount: s?.guilds.length ?? 0,
    servers,
  }
}
