/**
 * What the background update check found, as the browser sees it. Shared by the panel's
 * checker and the badges.
 */

export interface FlytowerUpdate {
  current: string
  /** A newer release on the chosen channel, or null when up to date. */
  latest: { version: string; prerelease: boolean; url: string } | null
}

export interface ContentUpdate {
  label: string
  from?: string
  to?: string
}

export interface ContentUpdates {
  updates: ContentUpdate[]
}

export interface MinecraftUpdate {
  current: string
  /** The newest Minecraft release the loader offers, if newer than `current`. */
  newest: string | null
  /** The newest newer release that every installed item has a build for. */
  ready: string | null
  /** Why `newest` isn't ready, one line per item without a build. */
  missing: string[]
}

export interface JavaUpdate {
  major: number
  installed: string
  /** A newer Temurin build for this major, or null when up to date. */
  latest: string | null
  /** Servers that use this Java. */
  servers: string[]
}

/** One check's last good result, and the last failure if the newest attempt failed. */
export interface Checked<T> {
  summary: T | null
  checkedAt: string | null
  error: string | null
  errorAt: string | null
}

export interface UpdatesSnapshot {
  /** A check is running now. */
  checking: boolean
  /** When the last full check finished, ISO. */
  lastRunAt: string | null
  flytower: Checked<FlytowerUpdate> | null
  java: Checked<JavaUpdate>[]
  servers: Record<
    string,
    { content: Checked<ContentUpdates> | null; minecraft: Checked<MinecraftUpdate> | null }
  >
}

/** How many content updates a server has, for its badge. */
export function serverUpdateCount(s: UpdatesSnapshot | null | undefined, server: string): number {
  return s?.servers[server]?.content?.summary?.updates.length ?? 0
}

/** Updates waiting on System: Flytower itself and each Java runtime. */
export function systemUpdateCount(s: UpdatesSnapshot | null | undefined): number {
  if (!s) return 0
  return (s.flytower?.summary?.latest ? 1 : 0) + s.java.filter((j) => j.summary?.latest).length
}

/** The newest failure among a set of checks whose newest attempt failed, if any. */
export function failedCheck(
  checks: (Checked<unknown> | null | undefined)[],
): { error: string; at: string } | null {
  let worst: { error: string; at: string } | null = null
  for (const c of checks) {
    if (!c?.error || !c.errorAt) continue
    if (!worst || c.errorAt > worst.at) worst = { error: c.error, at: c.errorAt }
  }
  return worst
}
