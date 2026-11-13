import { ProviderError, type Fetch } from './types.ts'

export const USER_AGENT = 'flytower (+https://github.com/teamflytower/flytower)'

/** GETs JSON with a 20 s timeout and turns failures into one readable error. */
export async function getJson<T>(fetchImpl: Fetch, url: string, source: string): Promise<T> {
  let res: Response
  try {
    res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ProviderError(`Couldn't reach ${source}. Check the server's internet connection.`)
  }
  if (res.status === 404) throw new ProviderError(`${source} doesn't know about that version.`)
  if (!res.ok) throw new ProviderError(`${source} answered ${res.status}. Try again in a minute.`)
  return (await res.json()) as T
}

/** A tiny time-based cache so browsing version lists doesn't hammer upstream APIs. */
export function cached<T>(ttlMs: number, now: () => number = Date.now) {
  const store = new Map<string, { at: number; value: Promise<T> }>()
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key)
    if (hit && now() - hit.at < ttlMs) return hit.value
    const value = load()
    store.set(key, { at: now(), value })
    value.catch(() => store.delete(key))
    return value
  }
}
