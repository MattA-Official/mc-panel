/**
 * Fetching a link someone pasted to import. Redirects are followed by hand so every hop is
 * checked the same way as the first: https, and not an address on this machine or its local
 * network, so a link can't be bounced onto something only the box itself can reach.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const MAX_REDIRECTS = 5

export class LinkError extends Error {
  override name = 'LinkError'
}

export type Lookup = (host: string) => Promise<string[]>

const defaultLookup: Lookup = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

/** Loopback, private, link-local, carrier-grade NAT, unspecified and multicast addresses. */
export function isLocalAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
    if (mapped) return isLocalAddress(mapped[1]!)
    return (
      s === '::' ||
      s === '::1' ||
      /^f[cd]/.test(s) || // unique local
      /^fe[89ab]/.test(s) || // link-local
      s.startsWith('ff') // multicast
    )
  }
  return true
}

async function check(url: URL, resolve: Lookup) {
  if (url.protocol !== 'https:') throw new LinkError('Only https links can be imported.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost'))
    throw new LinkError("Links to this machine can't be imported.")
  let addresses: string[]
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = await resolve(host)
    } catch {
      throw new LinkError(`Couldn't find ${host}.`)
    }
  }
  if (!addresses.length || addresses.some(isLocalAddress))
    throw new LinkError("Links to this machine or its local network can't be imported.")
}

/** Fetches `url`, checking it and every redirect it leads to. */
export async function fetchLink(
  url: URL,
  opts: { fetch?: typeof fetch; lookup?: Lookup; signal?: AbortSignal } = {},
): Promise<Response> {
  const f = opts.fetch ?? fetch
  const resolve = opts.lookup ?? defaultLookup
  let at = url
  for (let hop = 0; ; hop++) {
    await check(at, resolve)
    const res = await f(at, { redirect: 'manual', signal: opts.signal })
    const to = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !to) return res
    void res.body?.cancel()
    if (hop >= MAX_REDIRECTS) throw new LinkError('That link redirects too many times.')
    try {
      at = new URL(to, at)
    } catch {
      throw new LinkError('That link redirects somewhere invalid.')
    }
  }
}
