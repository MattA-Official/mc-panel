import { describe, expect, test } from 'bun:test'
import { mkdtemp, exists } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLoaders, downloadVerified, ProviderError, type Fetch } from '../src/index.ts'

const fixture = (name: string) => Bun.file(join(import.meta.dir, 'fixtures', name)).text()

const JAR = 'fake jar!'
const JAR_SHA1 = new Bun.CryptoHasher('sha1').update(JAR).digest('hex')

/** Serves the recorded upstream responses; anything else is a 404. */
function fixtureFetch(calls: string[] = []): Fetch {
  const routes: Record<string, () => Promise<string>> = {
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json': () =>
      fixture('manifest.json'),
    'https://piston-meta.mojang.com/v1/packages/bbb/26.3.json': async () =>
      (await fixture('version-26.3.json')).replace('SERVER_SHA1', JAR_SHA1),
    'https://piston-meta.mojang.com/v1/packages/ccc/1.16.5.json': () =>
      fixture('version-1.16.5.json'),
    'https://meta.fabricmc.net/v2/versions/game': () => fixture('fabric-game.json'),
    'https://meta.fabricmc.net/v2/versions/loader/26.3': () => fixture('fabric-loader-26.3.json'),
    'https://meta.fabricmc.net/v2/versions/loader/1.99': async () => '[]',
    'https://meta.fabricmc.net/v2/versions/installer': () => fixture('fabric-installer.json'),
    'https://piston-data.mojang.com/v1/objects/bbb/server.jar': async () => JAR,
  }
  return async (input) => {
    const url = String(input)
    calls.push(url)
    const route = routes[url]
    return route ? new Response(await route()) : new Response('nope', { status: 404 })
  }
}

describe('vanilla', () => {
  test('lists releases only unless snapshots are asked for', async () => {
    const { vanilla } = createLoaders(fixtureFetch())
    expect((await vanilla.minecraftVersions()).map((v) => v.id)).toEqual(['26.3', '1.16.5'])
    expect(await vanilla.minecraftVersions({ includeSnapshots: true })).toHaveLength(3)
  })

  test('resolves the server jar with its sha1 and Java version', async () => {
    const { vanilla } = createLoaders(fixtureFetch())
    expect(await vanilla.resolve('26.3')).toEqual({
      url: 'https://piston-data.mojang.com/v1/objects/bbb/server.jar',
      hash: { algorithm: 'sha1', value: JAR_SHA1 },
      javaMajor: 25,
      loaderVersion: null,
    })
  })

  test('old versions default to Java 8', async () => {
    const { vanilla } = createLoaders(fixtureFetch())
    expect((await vanilla.resolve('1.16.5')).javaMajor).toBe(8)
  })

  test('unknown versions give a readable error', async () => {
    const { vanilla } = createLoaders(fixtureFetch())
    expect(vanilla.resolve('9.9')).rejects.toThrow("Minecraft 9.9 doesn't exist.")
  })

  test('caches the manifest', async () => {
    const calls: string[] = []
    const { vanilla } = createLoaders(fixtureFetch(calls))
    await vanilla.minecraftVersions()
    await vanilla.resolve('26.3')
    expect(calls.filter((c) => c.endsWith('version_manifest_v2.json'))).toHaveLength(1)
  })
})

describe('fabric', () => {
  test('resolves the latest stable loader and installer', async () => {
    const { fabric } = createLoaders(fixtureFetch())
    expect(await fabric.resolve('26.3')).toEqual({
      url: 'https://meta.fabricmc.net/v2/versions/loader/26.3/0.18.4/1.1.1/server/jar',
      hash: null,
      javaMajor: 25,
      loaderVersion: '0.18.4',
    })
  })

  test('pins a specific loader version', async () => {
    const { fabric } = createLoaders(fixtureFetch())
    expect((await fabric.resolve('26.3', '0.18.3')).loaderVersion).toBe('0.18.3')
    expect(fabric.resolve('26.3', '0.1.0')).rejects.toThrow(ProviderError)
  })

  test('filters snapshots from the game list', async () => {
    const { fabric } = createLoaders(fixtureFetch())
    expect((await fabric.minecraftVersions()).map((v) => v.id)).toEqual(['26.3'])
  })

  test('says when Fabric has no loader for a version', async () => {
    const { fabric } = createLoaders(fixtureFetch())
    expect(fabric.resolve('1.99')).rejects.toThrow("Fabric doesn't support Minecraft 1.99 yet.")
  })
})

describe('downloadVerified', () => {
  const url = 'https://piston-data.mojang.com/v1/objects/bbb/server.jar'

  test('accepts a matching sha1 and returns the sha256', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'ft-')), 'server.jar')
    const out = await downloadVerified(fixtureFetch(), url, dest, {
      algorithm: 'sha1',
      value: JAR_SHA1,
    })
    expect(out).toEqual({
      sha256: new Bun.CryptoHasher('sha256').update(JAR).digest('hex'),
      bytes: 9,
    })
    expect(await Bun.file(dest).text()).toBe(JAR)
  })

  test('rejects and deletes a file that fails its checksum', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'ft-')), 'server.jar')
    expect(
      downloadVerified(fixtureFetch(), url, dest, { algorithm: 'sha1', value: '0'.repeat(40) }),
    ).rejects.toThrow("didn't match its published checksum")
    await Bun.sleep(20)
    expect(await exists(dest)).toBe(false)
  })

  test('reports HTTP failures', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'ft-')), 'x')
    expect(downloadVerified(fixtureFetch(), 'https://example.com/x', dest, null)).rejects.toThrow(
      '(404)',
    )
  })
})
