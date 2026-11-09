import type { H3Event } from 'h3'

const hits = new Map<string, { count: number; resetAt: number }>()

/**
 * A small fixed-window limiter for the endpoints that take guessable secrets
 * (recovery codes). One process per box, so memory is enough.
 */
export function limit(event: H3Event, bucket: string, max = 10, windowMs = 15 * 60_000) {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count++
  if (entry.count > max) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many attempts. Wait 15 minutes and try again.',
    })
  }
}
