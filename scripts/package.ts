/**
 * Builds a release tarball for one architecture.
 *
 *   bun scripts/package.ts --version 0.1.0 --arch amd64 [--bun /path/to/bun] [--out dist]
 *
 * Expects `bun run build` to have produced apps/panel/.output. Without --bun it downloads
 * the official Bun release matching packageManager in package.json and checks its hash.
 */
import { chmod, cp, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { $ } from 'bun'

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    arch: { type: 'string' },
    bun: { type: 'string' },
    out: { type: 'string', default: 'dist' },
  },
})

const repo = resolve(import.meta.dir, '..')
const version = values.version?.replace(/^v/, '')
const arch = values.arch
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version))
  throw new Error('--version x.y.z is required')
if (arch !== 'amd64' && arch !== 'arm64') throw new Error('--arch must be amd64 or arm64')

const out = resolve(repo, values.out!)
const name = `flytower-${version}`
const stage = join(out, `stage-${arch}`, name)
await rm(join(out, `stage-${arch}`), { recursive: true, force: true })
await mkdir(join(stage, 'bin'), { recursive: true })

// Panel: the Nitro output is plain JavaScript, so one build serves both architectures.
const panelOutput = join(repo, 'apps/panel/.output')
if (!(await Bun.file(join(panelOutput, 'server/index.mjs')).exists())) {
  throw new Error('apps/panel/.output is missing; run `bun run build` first')
}
// Nitro links duplicate dependency versions with absolute symlinks into the build folder,
// which won't exist on the server. Copy the real files instead.
await cp(panelOutput, join(stage, 'panel'), { recursive: true, dereference: true })
const links = (await $`find ${join(stage, 'panel')} -type l`.text()).trim()
if (links) throw new Error(`symlinks left in the panel output:\n${links}`)

// Agent: one bundled file, no node_modules.
const agent = await Bun.build({
  entrypoints: [join(repo, 'packages/agent/src/main.ts')],
  target: 'bun',
  outdir: join(stage, 'agent'),
  naming: 'agent.js',
  minify: false,
})
if (!agent.success) throw new AggregateError(agent.logs, 'agent bundle failed')
// The updater runs from the release it installs, as its own process.
const updater = await Bun.build({
  entrypoints: [join(repo, 'packages/agent/src/updater-main.ts')],
  target: 'bun',
  outdir: join(stage, 'agent'),
  naming: 'updater.js',
  minify: false,
})
if (!updater.success) throw new AggregateError(updater.logs, 'updater bundle failed')

// Bun itself.
const bunTarget = join(stage, 'bin/bun')
if (values.bun) {
  await cp(values.bun, bunTarget)
} else {
  const pkg = await Bun.file(join(repo, 'package.json')).json()
  const bunVersion = String(pkg.packageManager).replace(/^bun@/, '')
  const asset = arch === 'amd64' ? 'bun-linux-x64' : 'bun-linux-aarch64'
  const base = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}`
  const tmp = join(out, `${asset}.zip`)
  await $`curl -fsSL -o ${tmp} ${base}/${asset}.zip`
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text()
  const expected = sums
    .split('\n')
    .find((l) => l.endsWith(` ${asset}.zip`))
    ?.split(/\s+/)[0]
  const actual = new Bun.CryptoHasher('sha256').update(await Bun.file(tmp).bytes()).digest('hex')
  if (!expected || expected !== actual) throw new Error(`${asset}.zip failed its checksum`)
  await $`unzip -q -o ${tmp} -d ${out}`
  await cp(join(out, asset, 'bun'), bunTarget)
}
await chmod(bunTarget, 0o755)

await cp(join(repo, 'installer/install.sh'), join(stage, 'install.sh'))
await chmod(join(stage, 'install.sh'), 0o755)
await Bun.write(join(stage, 'VERSION'), `${version}\n`)

const tarball = join(out, `${name}-linux-${arch}.tar.gz`)
// System tar keeps the executable bits that Bun.Archive currently drops.
await $`tar --owner=0 --group=0 --numeric-owner -czf ${tarball} -C ${join(out, `stage-${arch}`)} ${name}`
await rm(join(out, `stage-${arch}`), { recursive: true, force: true })
console.log(tarball)
