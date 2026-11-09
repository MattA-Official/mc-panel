import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError, type Params, type Result } from '@kiln/protocol'
import type { AgentContext } from '../context.ts'
import { downloadVerified, getJson } from '../download.ts'

interface AdoptiumAsset {
  binary: { package: { link: string; checksum: string; name: string } }
  version: { semver: string }
}

const ADOPTIUM = 'https://api.adoptium.net/v3/assets/latest'
const MARKER = '.kiln-runtime.json'

const adoptiumArch = (arch: string) => {
  if (arch === 'x64') return 'x64'
  if (arch === 'arm64') return 'aarch64'
  throw new AgentError('failed', `unsupported CPU architecture ${arch}`)
}

async function latestAsset(ctx: AgentContext, major: number): Promise<AdoptiumAsset> {
  const arch = adoptiumArch(ctx.arch)
  // Prefer the smaller JRE; some releases only publish a JDK.
  for (const image of ['jre', 'jdk']) {
    const url = `${ADOPTIUM}/${major}/hotspot?architecture=${arch}&image_type=${image}&os=linux&vendor=eclipse`
    const assets = await getJson<AdoptiumAsset[]>(ctx.fetch, url)
    const first = assets.find((a) => a.binary?.package?.link?.endsWith('.tar.gz'))
    if (first) return first
  }
  throw new AgentError('not_found', `no Temurin ${major} build for ${arch}`)
}

/**
 * Installs Eclipse Temurin <major> under runtimes/temurin-<major>. Downloads from the
 * Adoptium API (not apt), verifies the SHA-256 it publishes, unpacks into a staging
 * folder and renames it into place, so a half-finished install is never visible.
 */
export async function install(
  p: Params<'runtime.install'>,
  ctx: AgentContext,
): Promise<Result<'runtime.install'>> {
  const javaHome = join(ctx.paths.runtimes, `temurin-${p.major}`)
  const marker = join(javaHome, MARKER)
  if (existsSync(marker)) {
    const { version } = JSON.parse(await readFile(marker, 'utf8')) as { version: string }
    return { javaHome, version, alreadyInstalled: true }
  }

  const asset = await latestAsset(ctx, p.major)
  await mkdir(ctx.paths.runtimes, { recursive: true, mode: 0o755 })
  const staging = `${javaHome}.staging-${process.pid}`
  const archive = `${staging}.tar.gz`
  try {
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { mode: 0o755 })
    await downloadVerified(
      ctx.fetch,
      asset.binary.package.link,
      archive,
      asset.binary.package.checksum,
    )
    const tar = await ctx.exec('tar', [
      '-xzf',
      archive,
      '-C',
      staging,
      '--strip-components=1',
      '--no-same-owner',
    ])
    if (tar.code !== 0)
      throw new AgentError('failed', `could not unpack Java: ${tar.stderr.trim()}`)
    if (!existsSync(join(staging, 'bin', 'java')))
      throw new AgentError('failed', 'unpacked Java has no bin/java')
    await writeFile(
      join(staging, MARKER),
      JSON.stringify({ vendor: 'temurin', version: asset.version.semver }),
    )
    await rm(javaHome, { recursive: true, force: true })
    await rename(staging, javaHome)
  } finally {
    await rm(archive, { force: true })
    await rm(staging, { recursive: true, force: true })
  }
  return { javaHome, version: asset.version.semver, alreadyInstalled: false }
}
