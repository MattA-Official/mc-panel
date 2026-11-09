/** Finding newer Flytower releases on GitHub. Installing them is the agent's job. */

export interface Release {
  version: string
  notes: string
  url: string
  publishedAt: string
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com/repos/MattA-Official/mc-panel/releases?per_page=20'

/** Compares x.y.z[-pre] versions: negative if a is older. A pre-release sorts first. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.replace(/^v/, '').split('-', 2)
    return { nums: main!.split('.').map(Number), pre: pre ?? null }
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
  return x.pre < y.pre ? -1 : 1
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
    }))
    .sort((a, b) => compareVersions(b.version, a.version))
}

let cache: { at: number; releases: Release[] } | null = null

/** The newest release, checked at most hourly. */
export async function newestRelease(force = false): Promise<Release | null> {
  if (force || !cache || Date.now() - cache.at > 60 * 60_000) {
    cache = { at: Date.now(), releases: await listReleases() }
  }
  return cache.releases[0] ?? null
}
