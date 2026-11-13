/** Finding newer Flytower releases on GitHub. Installing them is the agent's job. */
import { compareVersions } from '@flytower/protocol'
import type { UpdateChannel } from './settings'

export interface Release {
  version: string
  notes: string
  url: string
  publishedAt: string
  /** A beta: marked as a pre-release on GitHub, or a version like 1.1.0-beta.1. */
  prerelease: boolean
  /**
   * A build of the `native` branch (Rust and Go, docs/decisions/0001-rust-and-go.md), tagged
   * `native-<version>` rather than `v<version>` so panels from before the Native channel never
   * see it. Only the Native channel offers these.
   */
  native: boolean
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com/repos/teamflytower/flytower/releases?per_page=30'

const isPre = (version: string) => version.replace(/^v/, '').includes('-')

/**
 * A native build's version: the release it's built alongside plus a native counter, such as
 * 1.2.0-beta.2.native.1 (with 1.2.0-beta.2) or 1.2.0-native.1 (with 1.2.0).
 */
export const isNative = (version: string) => /-(.+\.)?native\.\d+$/.test(version)

/** The release tag for a version: native builds have their own, so older panels skip them. */
export const releaseTag = (version: string) =>
  isNative(version) ? `native-${version}` : `v${version}`

export { compareVersions }

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
  return (
    body
      .filter((r) => !r.draft && /^(v|native-)\d+\.\d+\.\d+/.test(r.tag_name))
      .filter((r) => r.assets.some((a) => a.name === 'SHA256SUMS.sig'))
      .map((r) => {
        const version = r.tag_name.replace(/^(v|native-)/, '')
        return {
          version,
          notes: r.body ?? '',
          url: r.html_url,
          publishedAt: r.published_at,
          prerelease: !!r.prerelease || isPre(version),
          native: r.tag_name.startsWith('native-'),
        }
      })
      // A native-looking version under a v tag, or the other way round, is a mistake: skip it.
      .filter((r) => r.native === isNative(r.version))
      .sort((a, b) => compareVersions(b.version, a.version))
  )
}

/**
 * Releases offered on a channel. Stable skips betas. Beta offers betas too, but never native
 * builds. Native offers only native builds: 1.2.0 sorts after 1.2.0-native.1, so offering
 * stable releases there would take a native install off native without anyone asking.
 */
export function onChannel(releases: Release[], channel: UpdateChannel): Release[] {
  if (channel === 'native') return releases.filter((r) => r.native)
  if (channel === 'beta') return releases.filter((r) => !r.native)
  return releases.filter((r) => !r.prerelease)
}

/**
 * The channel to use when nobody has chosen one: Beta if this install is already running a
 * beta (someone chose to install it), otherwise Stable.
 */
export function defaultChannel(current: string): UpdateChannel {
  if (isNative(current)) return 'native'
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
