export interface PropertiesInput {
  port: number
  rconPort: number
  rconPassword: string
  motd: string
}

/**
 * The first `server.properties` a new server gets. Only what Flytower depends on is set;
 * Minecraft fills in every other default on first start. RCON is bound to the loopback by
 * the firewall (its port is never opened), and the password never leaves the panel.
 */
export function defaultProperties(p: PropertiesInput): string {
  const lines: Record<string, string | number | boolean> = {
    'server-port': p.port,
    'enable-rcon': true,
    'rcon.port': p.rconPort,
    'rcon.password': p.rconPassword,
    'broadcast-rcon-to-ops': false,
    'enable-query': false,
    motd: escapeValue(p.motd),
  }
  return (
    '# Written by Flytower on creation. Edit freely; Flytower only manages the RCON lines.\n' +
    Object.entries(lines)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n'
  )
}

/** Java properties escaping for a single-line value. */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** 24 random bytes as base64url: long enough, and safe in a properties file. */
export const randomPassword = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * A fresh secret for a cloned server: 40 letters and digits, the shape Minecraft wants for
 * `management-server-secret`. Bytes of 248 and up are thrown away so every character is
 * equally likely.
 */
export function randomSecret(length = 40): string {
  let out = ''
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < 248 && out.length < length) out += ALPHANUMERIC[b % 62]
    }
  }
  return out
}

export const EULA = (acceptedAt: Date) =>
  `# Accepted in Flytower at ${acceptedAt.toISOString()} (https://aka.ms/MinecraftEULA)\neula=true\n`
