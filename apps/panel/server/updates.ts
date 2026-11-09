/** Finding newer Flytower releases on GitHub. Installing them is the agent's job. */
import type { UpdateChannel } from './settings'

export interface Release {
  version: string
  notes: string
  url: string
  publishedAt: string
  /** A beta: marked as a pre-release on GitHub, or a version like 1.1.0-beta.1. */
  prerelease: boolean
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com/repos/MattA-Official/mc-panel/releases?per_page=30'

const isPre = (version: string) => version.replace(/^v/, '').includes('-')

/**
 * Compares x.y.z[-pre] versions: negative if a is older. A pre-release sorts before its
 * release, and pre-release parts compare as semver does (beta.9 before beta.10).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const s = v.replace(/^v/, '')
    const dash = s.indexOf('-')
    const main = dash < 0 ? s : s.slice(0, dash)
    return { nums: main.split('.').map(Number), pre: dash < 0 ? null : s.slice(dash + 1) }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  const xp = x.pre.split('.')
  const yp = y.pre.split('.')
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const p = xp[i]
    const q = yp[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) - Number(q)
    if (pn) return -1
    if (qn) return 1
    return p < q ? -1 : 1
  }
  return 0
}

/** Signed releases, newest first. Releases from before signing can't be installed. */
export async function listReleases(fetchImpl: Fetch = fetch): Promise<Release[]> {
  const res = await fetchImpl(API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'flytower-panel' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const body = (await res.json()) as {
    tag_name: string
    body: string | null
    html_url: string
    published_at: string
    draft: boolean
    prerelease?: boolean
    assets: { name: string }[]
  }[]
  return body
    .filter((r) => !r.draft && /^v\d+\.\d+\.\d+/.test(r.tag_name))
    .filter((r) => r.assets.some((a) => a.name === 'SHA256SUMS.sig'))
    .map((r) => ({
      version: r.tag_name.slice(1),
      notes: r.body ?? '',
      url: r.html_url,
      publishedAt: r.published_at,
      prerelease: !!r.prerelease || isPre(r.tag_name),
    }))
    .sort((a, b) => compareVersions(b.version, a.version))
}

/** Releases offered on a channel: Stable skips betas, Beta offers everything. */
export function onChannel(releases: Release[], channel: UpdateChannel): Release[] {
  return channel === 'beta' ? releases : releases.filter((r) => !r.prerelease)
}

/**
 * The channel to use when nobody has chosen one: Beta if this install is already running a
 * beta (someone chose to install it), otherwise Stable.
 */
export function defaultChannel(current: string): UpdateChannel {
  return isPre(current) ? 'beta' : 'stable'
}

let cache: { at: number; releases: Release[] } | null = null

/** The newest release on a channel, with GitHub checked at most hourly. */
export async function newestRelease(
  channel: UpdateChannel,
  force = false,
): Promise<Release | null> {
  if (force || !cache || Date.now() - cache.at > 60 * 60_000) {
    cache = { at: Date.now(), releases: await listReleases() }
  }
  return onChannel(cache.releases, channel)[0] ?? null
}
