/**
 * Reads `#token=…` from the address once and removes it, so the token isn't left in the
 * address bar or history. The `#` part never reaches the server or its logs.
 */
export function takeLinkToken(): string | null {
  if (import.meta.server) return null
  const match = /(?:^#|&)token=([^&]+)/.exec(location.hash)
  if (!match) return null
  history.replaceState(history.state, '', location.pathname + location.search)
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}
