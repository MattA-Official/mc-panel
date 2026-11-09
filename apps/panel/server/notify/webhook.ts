/** A plain JSON webhook, signed with HMAC-SHA256 so the receiver can check it came from us. */
import type { Message, Sender } from './types'
import { postJson } from './types'

export function webhookPayload(msg: Message) {
  return {
    version: 1,
    id: msg.id,
    kind: msg.kind,
    severity: msg.severity,
    title: msg.title,
    detail: msg.detail ?? null,
    server: msg.server ? { name: msg.server, displayName: msg.serverDisplayName } : null,
    link: msg.url,
    at: msg.at.toISOString(),
  }
}

/** `sha256=<hex>` of the exact body sent. */
export function sign(body: string, secret: string): string {
  const mac = new Bun.CryptoHasher('sha256', secret).update(body).digest('hex')
  return `sha256=${mac}`
}

export const sendWebhook: Sender = async (msg, to, fetchImpl) => {
  const body = JSON.stringify(webhookPayload(msg))
  const headers: Record<string, string> = {
    'x-flytower-event': msg.kind,
    'x-flytower-delivery': msg.id,
  }
  if (to.secret) headers['x-flytower-signature'] = sign(body, to.secret)
  await postJson(fetchImpl, to.url, body, headers, 'The webhook')
}
