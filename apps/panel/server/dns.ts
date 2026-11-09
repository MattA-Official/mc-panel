/**
 * The DNS records a server's hostname needs, and a live check of them. Works with any DNS
 * provider: nothing here talks to one, it only reads public DNS.
 */
import { Resolver } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'

export type RecordType = 'A' | 'AAAA' | 'SRV'

export interface ExpectedRecord {
  type: RecordType
  name: string
  /** For SRV: "priority weight port target". */
  value: string
}

export interface CheckedRecord extends ExpectedRecord {
  status: 'ok' | 'missing' | 'wrong'
  /** What DNS says now. */
  found: string[]
  hint?: string
}

export interface MachineAddresses {
  ipv4: string | null
  ipv6: string | null
}

const isPrivate4 = (ip: string) =>
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
    ip,
  )
const isPublic6 = (ip: string) => /^[23][0-9a-f]{3}:/i.test(ip)

/** The machine's public addresses, from its own network interfaces. */
export function machineAddresses(
  overrides: Partial<MachineAddresses> = {},
  interfaces = networkInterfaces(),
): MachineAddresses {
  const all = Object.values(interfaces).flatMap((list) => list ?? [])
  const ipv4 = all.find((i) => i.family === 'IPv4' && !i.internal && !isPrivate4(i.address))
  const ipv6 = all.find((i) => i.family === 'IPv6' && !i.internal && isPublic6(i.address))
  return {
    ipv4: overrides.ipv4 || ipv4?.address || null,
    ipv6: overrides.ipv6 || ipv6?.address || null,
  }
}

export function expectedRecords(
  hostname: string,
  port: number,
  machine: MachineAddresses,
): ExpectedRecord[] {
  const out: ExpectedRecord[] = []
  if (machine.ipv4) out.push({ type: 'A', name: hostname, value: machine.ipv4 })
  if (machine.ipv6) out.push({ type: 'AAAA', name: hostname, value: machine.ipv6 })
  if (port !== 25565) {
    out.push({ type: 'SRV', name: `_minecraft._tcp.${hostname}`, value: `0 5 ${port} ${hostname}` })
  }
  return out
}

/** The lookups the check needs; a real resolver, or a fake in tests. */
export interface Lookup {
  a(name: string): Promise<string[]>
  aaaa(name: string): Promise<string[]>
  srv(name: string): Promise<{ priority: number; weight: number; port: number; name: string }[]>
}

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN', 'ENOTIMP'])
const empty = <T>(p: Promise<T[]>) =>
  p.catch((err: NodeJS.ErrnoException) => {
    if (NOT_FOUND.has(err.code ?? '')) return [] as T[]
    throw err
  })

/** Looks records up through public resolvers, so the machine's own cache doesn't hide changes. */
export function publicLookup(): Lookup {
  const r = new Resolver({ timeout: 5000, tries: 2 })
  r.setServers(['1.1.1.1', '8.8.8.8'])
  return {
    a: (n) => empty(r.resolve4(n)),
    aaaa: (n) => empty(r.resolve6(n)),
    srv: (n) => empty(r.resolveSrv(n)),
  }
}

/** Cloudflare's proxy ranges (IPv4), which Minecraft traffic can't go through. */
const CLOUDFLARE =
  /^(104\.(1[6-9]|2\d|3[01])\.|172\.(6[4-9]|7[01])\.|173\.245\.(4[89]|5\d|6[0-3])\.|103\.21\.24[4-7]\.|103\.22\.20[0-3]\.|103\.31\.[4-7]\.|141\.101\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|108\.162\.(19[2-9]|2[0-5]\d)\.|190\.93\.(24\d|25[0-5])\.|188\.114\.(9[6-9]|10\d|11[01])\.|197\.234\.24[0-3]\.|198\.41\.(12[89]|1[3-9]\d|2[0-5]\d)\.|162\.(15[89])\.|131\.0\.7[2-5]\.)/

const trimDot = (s: string) => s.replace(/\.$/, '').toLowerCase()

export async function checkRecords(
  expected: ExpectedRecord[],
  lookup: Lookup,
): Promise<CheckedRecord[]> {
  return Promise.all(
    expected.map(async (e): Promise<CheckedRecord> => {
      let found: string[]
      if (e.type === 'SRV') {
        found = (await lookup.srv(e.name)).map(
          (s) => `${s.priority} ${s.weight} ${s.port} ${trimDot(s.name)}`,
        )
        const [, , port, target] = e.value.split(' ')
        const ok = found.some((f) => {
          const [, , p, t] = f.split(' ')
          return p === port && t === target
        })
        return { ...e, found, status: ok ? 'ok' : found.length ? 'wrong' : 'missing' }
      }
      found = await (e.type === 'A' ? lookup.a(e.name) : lookup.aaaa(e.name))
      const ok = found.includes(e.value)
      const proxied = e.type === 'A' && !ok && found.some((ip) => CLOUDFLARE.test(ip))
      return {
        ...e,
        found,
        status: ok ? 'ok' : found.length ? 'wrong' : 'missing',
        ...(proxied
          ? {
              hint: "This points at Cloudflare's proxy, which Minecraft can't use. Set the record to DNS only (grey cloud).",
            }
          : {}),
      }
    }),
  )
}
