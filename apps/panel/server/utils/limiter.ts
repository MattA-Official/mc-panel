import type { H3Event } from 'h3'

const hits = new Map<string, { count: number; resetAt: number }>()
let nextSweep = 0

/**
 * A small fixed-window limiter for the endpoints that take guessable secrets
 * (recovery codes). One process per box, so memory is enough.
 */
export function limit(event: H3Event, bucket: string, max = 10, windowMs = 15 * 60_000) {
  hit(`${bucket}:${clientIp(event)}`, max, windowMs)
}

/**
 * The same, counted across everyone. For routes where each request is expensive, so a
 * spread of addresses can't add up to more work than the box should do.
 */
export function limitAll(bucket: string, max: number, windowMs = 15 * 60_000) {
  hit(`${bucket}:*`, max, windowMs)
}

function hit(key: string, max: number, windowMs: number) {
  const now = Date.now()
  sweep(now)
  const entry = hits.get(key)
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  entry.count++
  if (entry.count > max) {
    const minutes = Math.max(1, Math.ceil((entry.resetAt - now) / 60_000))
    throw createError({
      statusCode: 429,
      statusMessage: `Too many attempts. Wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    })
  }
}

/** Forgets windows that have ended, at most once a minute, so busy public pages don't pile up. */
function sweep(now: number) {
  if (now < nextSweep) return
  nextSweep = now + 60_000
  for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key)
}

/**
 * The address to count against. Behind a proxy that's the last hop it added to
 * X-Forwarded-For: anything to its left came from the client and can be made up. The
 * installer's Caddy replaces the header, so there it's the only entry.
 */
export function clientIp(event: H3Event): string {
  const forwarded = getRequestHeader(event, 'x-forwarded-for')
  const last = forwarded?.split(',').at(-1)?.trim()
  return last || getRequestIP(event) || 'unknown'
}

/** For tests. */
export function resetLimits() {
  hits.clear()
  nextSweep = 0
}
