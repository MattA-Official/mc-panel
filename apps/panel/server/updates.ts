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
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.github.com/repos/teamflytower/flytower/releases?per_page=30'

const isPre = (version: string) => version.replace(/^v/, '').includes('-')

const NATIVE = /[-.]native\.\d+$/

/**
 * The release a version goes with. From 1.2 to 1.4, native builds (the Rust agent, before
 * every release had it) added a counter to the release they were built alongside:
 * 1.2.0-beta.2.native.1 went with 1.2.0-beta.2, and 1.2.0-native.1 with 1.2.0. Since 1.5.0
 * every release has the Rust agent, and there are no more native builds.
 */
export const releaseOf = (version: string) =>
  /-(.+\.)?native\.\d+$/.test(version) ? version.replace(NATIVE, '') : version

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
      // Only v tags: the native- tags of 1.2 to 1.4 are retired.
      .filter((r) => !r.draft && /^v\d+\.\d+\.\d+/.test(r.tag_name))
      .filter((r) => r.assets.some((a) => a.name === 'SHA256SUMS.sig'))
      .map((r) => {
        const version = r.tag_name.replace(/^v/, '')
        return {
          version,
          notes: r.body ?? '',
          url: r.html_url,
          publishedAt: r.published_at,
          prerelease: !!r.prerelease || isPre(version),
        }
      })
      // A native-looking version under a v tag is a mistake: skip it.
      .filter((r) => releaseOf(r.version) === r.version)
      .sort((a, b) => compareVersions(b.version, a.version))
  )
}

/** Releases offered on a channel. Stable skips betas; Beta offers both. */
export function onChannel(releases: Release[], channel: UpdateChannel): Release[] {
  if (channel === 'beta') return releases
  return releases.filter((r) => !r.prerelease)
}

/**
 * The channel to use when nobody has chosen one: Beta if this install is already running a
 * beta (someone chose to install it), otherwise Stable. A native build counts as the release
 * it went with.
 */
export function defaultChannel(current: string): UpdateChannel {
  return isPre(releaseOf(current)) ? 'beta' : 'stable'
}

/**
 * The chosen channel, or the default. `retired` is set while the choice is still the Native
 * channel from before 1.5.0, so the System page can say it ended and what replaced it.
 */
export function updateChannel(
  chosen: UpdateChannel | 'native' | undefined,
  current: string,
): { channel: UpdateChannel; retired: boolean } {
  if (chosen === 'native') return { channel: defaultChannel(current), retired: true }
  return { channel: chosen ?? defaultChannel(current), retired: false }
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
