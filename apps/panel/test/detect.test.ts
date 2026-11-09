import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { compareVersions, detect } from '../server/imports/detect'
import { levelDat } from './helpers/level-dat'

function make(files: Record<string, string | Uint8Array>) {
  const base = mkdtempSync(join(tmpdir(), 'ft-detect-'))
  for (const [path, body] of Object.entries(files)) {
    const p = join(base, path)
    mkdirSync(path.endsWith('/') ? p : dirname(p), { recursive: true })
    if (!path.endsWith('/')) writeFileSync(p, body)
  }
  return base
}

describe('detect', () => {
  it('finds a Fabric server inside a wrapper folder', async () => {
    const base = make({
      'my-server/server.properties': 'level-name=smp\nmotd=hi\n',
      'my-server/smp/level.dat': levelDat('26.3'),
      'my-server/mods/lithium.jar': 'x',
      'my-server/libraries/net/fabricmc/fabric-loader/0.18.9/x.jar': 'x',
      'my-server/libraries/net/fabricmc/fabric-loader/0.18.10/x.jar': 'x',
      'my-server/.fabric/': '',
      '__MACOSX/junk': 'x',
    })
    const d = await detect(base)
    expect(d).toMatchObject({
      root: join(base, 'my-server'),
      kind: 'server',
      loader: 'fabric',
      loaderVersion: '0.18.10',
      mcVersion: '26.3',
      levelName: 'smp',
      worldFound: true,
      hasMods: true,
      unsupported: null,
      warnings: [],
    })
  })

  it('reads a vanilla version from versions/ when there is no world', async () => {
    const d = await detect(
      make({
        'server.properties': '',
        'server.jar': 'x',
        'versions/1.21.4/server-1.21.4.jar': 'x',
      }),
    )
    expect(d).toMatchObject({
      kind: 'server',
      loader: 'vanilla',
      mcVersion: '1.21.4',
      worldFound: false,
    })
    expect(d.warnings[0]).toContain('No world found')
  })

  it('treats a singleplayer save as a world', async () => {
    const d = await detect(
      make({ 'My World/level.dat': levelDat('26.2'), 'My World/region/r.0.0.mca': 'x' }),
    )
    expect(d).toMatchObject({ kind: 'world', mcVersion: '26.2', worldFound: true })
    expect(d.root.endsWith('My World')).toBe(true)
  })

  it('recognises loaders it cannot run yet', async () => {
    expect(
      (await detect(make({ 'server.properties': '', 'paper.yml': '', 'plugins/': '' })))
        .unsupported,
    ).toBe('Paper, Spigot or Purpur')
    expect(
      (
        await detect(
          make({ 'server.properties': '', 'libraries/net/neoforged/neoforge/1/x.jar': '' }),
        )
      ).unsupported,
    ).toBe('NeoForge')
  })

  it('warns about mods without Fabric', async () => {
    const d = await detect(make({ 'server.properties': '', 'mods/a.jar': 'x' }))
    expect(d.warnings.some((w) => w.includes('no sign of Fabric'))).toBe(true)
  })

  it('compares versions numerically', () => {
    expect(compareVersions('0.18.10', '0.18.9')).toBeGreaterThan(0)
    expect(compareVersions('1.21', '1.21.1')).toBeLessThan(0)
  })
})
