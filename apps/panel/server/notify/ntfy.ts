/** ntfy: a push to your phone, published as JSON so non-English titles survive. */
import type { Severity } from '../../shared/notify'
import { DeliveryError, postJson, type Sender, type Message } from './types'

const PRIORITY: Record<Severity, number> = { critical: 5, warning: 4, info: 3, ok: 3 }
const TAGS: Record<Severity, string> = {
  critical: 'rotating_light',
  warning: 'warning',
  info: 'information_source',
  ok: 'white_check_mark',
}

/** Splits `https://ntfy.sh/my-topic` into the server and the topic. */
export function splitTopicUrl(url: string): { server: string; topic: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new DeliveryError("That isn't a web address.", null, true)
  }
  const parts = u.pathname.split('/').filter(Boolean)
  const topic = parts.pop()
  if (!topic || !/^[-_A-Za-z0-9]{1,64}$/.test(topic)) {
    throw new DeliveryError(
      'The address should end in the topic, like https://ntfy.sh/my-topic.',
      null,
      true,
    )
  }
  const path = parts.length ? `/${parts.join('/')}` : ''
  return { server: `${u.protocol}//${u.host}${path}/`, topic }
}

export function ntfyPayload(msg: Message, topic: string) {
  const body: Record<string, unknown> = {
    topic,
    title: msg.serverDisplayName ? `${msg.title} (${msg.serverDisplayName})` : msg.title,
    message: msg.detail || msg.title,
    priority: PRIORITY[msg.severity],
    tags: [TAGS[msg.severity]],
  }
  if (msg.url) body.click = msg.url
  return body
}

export const sendNtfy: Sender = async (msg, to, fetchImpl) => {
  const { server, topic } = splitTopicUrl(to.url)
  const headers: Record<string, string> = {}
  if (to.secret) headers.authorization = `Bearer ${to.secret}`
  await postJson(fetchImpl, server, ntfyPayload(msg, topic), headers, 'ntfy')
}
