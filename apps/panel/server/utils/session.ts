import type { H3Event } from 'h3'

/** Requires a signed-in user who has re-confirmed with a passkey in the last 5 minutes. */
export async function requireElevated(event: H3Event) {
  const session = await requireUserSession(event)
  if (!session.elevatedUntil || session.elevatedUntil < Date.now()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Confirm with your passkey first.',
      data: { elevate: true },
    })
  }
  return session
}

export const ELEVATION_MS = 5 * 60_000
