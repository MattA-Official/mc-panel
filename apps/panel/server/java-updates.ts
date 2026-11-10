/**
 * Newer builds of the Java runtimes Flytower installed. The agent installs Eclipse Temurin
 * under runtimes/temurin-<major> and writes a marker with the version it installed; this
 * compares that with Adoptium's newest build for the same major and CPU.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest'
const MARKER = '.flytower-runtime.json'

export interface InstalledRuntime {
  major: number
  /** Like 21.0.5+11.0.LTS, as Adoptium names it. */
  version: string
}

/**
 * Compares Temurin versions like 21.0.5+11.0.LTS: negative if a is older. Only the numbers
 * count, so 21.0.5+11 and 21.0.5+11.0.LTS are the same build.
 */
export function compareJava(a: string, b: string): number {
  // 25+36 is 25.0.0 build 36, so the version part (up to four numbers, like 17.0.4.1) is
  // padded before the build number.
  const nums = (v: string) => {
    const plus = v.indexOf('+')
    const ver = ((plus < 0 ? v : v.slice(0, plus)).match(/\d+/g) ?? []).map(Number)
    while (ver.length < 4) ver.push(0)
    const build = plus < 0 ? [] : (v.slice(plus + 1).match(/\d+/g) ?? []).map(Number)
    return [...ver.slice(0, 4), ...build]
  }
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** The runtimes the agent installed, read from their marker files. */
export async function installedRuntimes(dir: string): Promise<InstalledRuntime[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: InstalledRuntime[] = []
  for (const name of names) {
    const m = /^temurin-(\d+)$/.exec(name)
    if (!m) continue
    try {
      const marker = JSON.parse(await readFile(join(dir, name, MARKER), 'utf8')) as {
        version?: unknown
      }
      if (typeof marker.version === 'string')
        out.push({ major: Number(m[1]), version: marker.version })
    } catch {
      // Not finished installing, or not ours.
    }
  }
  return out.sort((a, b) => a.major - b.major)
}

const adoptiumArch = (arch: string) =>
  arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x64' : null

/**
 * Adoptium's newest Temurin build for a major, preferring the JRE as the agent does. Null
 * if there's none for this CPU.
 */
export async function latestTemurin(
  major: number,
  arch: string = process.arch,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  const a = adoptiumArch(arch)
  if (!a) return null
  for (const image of ['jre', 'jdk']) {
    const url = `${ADOPTIUM}/${major}/hotspot?architecture=${a}&image_type=${image}&os=linux&vendor=eclipse`
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'flytower-panel' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`Adoptium answered ${res.status}`)
    const assets = (await res.json()) as {
      binary?: { package?: { link?: string } }
      version?: { semver?: string }
    }[]
    const first = assets.find((x) => x.binary?.package?.link?.endsWith('.tar.gz'))
    if (first?.version?.semver) return first.version.semver
  }
  return null
}
