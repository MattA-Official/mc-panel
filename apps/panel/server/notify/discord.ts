/** Discord: an embed in Flytower's colours, posted to a channel webhook under the install's name. */
import type { Severity } from '../../shared/notify'
import { DeliveryError, postJson, type Message, type Sender } from './types'

/** Brand colours: crashed red, tungsten amber, info blue, running green. */
export const COLOURS: Record<Severity, number> = {
  critical: 0xc23535,
  warning: 0xf2a93b,
  info: 0x3462d4,
  ok: 0x1f7a4f,
}

const WEBHOOK =
  /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/

export function isDiscordWebhook(url: string): boolean {
  return WEBHOOK.test(url)
}

/** Stops player names like `__Steve__` turning into formatting. */
export function escapeMarkdown(s: string): string {
  return s.replace(/([\\*_~`|>[\]])/g, '\\$1')
}

export function discordPayload(msg: Message) {
  const name = msg.from?.name ?? 'Flytower'
  const embed: Record<string, unknown> = {
    title: msg.title.slice(0, 256),
    color: COLOURS[msg.severity],
    timestamp: msg.at.toISOString(),
    footer: { text: msg.serverDisplayName ? `${name} · ${msg.serverDisplayName}` : name },
  }
  if (msg.detail) embed.description = escapeMarkdown(msg.detail).slice(0, 4000)
  if (msg.url) embed.url = msg.url
  return {
    // Discord refuses webhook names that mention it (or its old bot, Clyde).
    username: /discord|clyde/i.test(name) ? 'Flytower' : name.slice(0, 80),
    ...(msg.from?.avatarUrl && { avatar_url: msg.from.avatarUrl }),
    embeds: [embed],
    // Player names and log text must never ping anyone.
    allowed_mentions: { parse: [] },
  }
}

export const sendDiscord: Sender = async (msg, to, fetchImpl) => {
  if (!isDiscordWebhook(to.url)) {
    throw new DeliveryError("That isn't a Discord webhook address.", null, true)
  }
  await postJson(fetchImpl, to.url, discordPayload(msg), {}, 'Discord')
}
