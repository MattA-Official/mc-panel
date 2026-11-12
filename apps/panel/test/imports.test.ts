import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { ImportService, STAGE_TTL_MS } from '../server/imports/service'
import { openDb } from '../server/db'
import { JobRunner } from '../server/jobs/runner'
import { entriesFor, writeZip } from '../server/zip'
import { levelDat } from './helpers/level-dat'

const body = (b: Uint8Array) => new Response(b).body!

function setup(
  opts: { free?: number; fetch?: typeof fetch; pastWorlds?: Record<number, string> } = {},
) {
  const base = mkdtempSync(join(tmpdir(), 'ft-imp-'))
  const db = openDb(':memory:')
  const jobs = new JobRunner({
    db,
    agent: (async () => ({})) as never,
    loaders: {} as never,
    fetch: (async () => new Response()) as never,
  })
  let clock = 1_000_000
  const service = new ImportService({
    importsDir: join(base, 'imports'),
    archiveDir: join(base, 'archive'),
    pastWorldPath: (id) => {
      const path = opts.pastWorlds?.[id]
      if (!path) throw new Error('No such past world.')
      return path
    },
    jobs,
    fetch: opts.fetch,
    lookup: async () => ['93.184.216.34'],
    now: () => clock,
    freeBytes: async () => opts.free ?? 1e12,
  })
  return { base, service, tick: (ms: number) => (clock += ms) }
}

async function serverZip(base: string) {
  const src = join(base, 'src', 'old-host')
  mkdirSync(join(src, 'world'), { recursive: true })
  mkdirSync(join(src, 'mods'))
  writeFileSync(join(src, 'server.properties'), 'motd=old\n')
  writeFileSync(join(src, 'world', 'level.dat'), levelDat('26.3'))
  writeFileSync(join(src, 'mods', 'a.jar'), 'x'.repeat(50_000))
  writeFileSync(join(src, 'fabric-server-launcher.properties'), 'serverJar=server.jar\n')
  const zip = join(base, 'server.zip')
  await writeZip(await entriesFor(src, 'old-host'), zip)
  return new Uint8Array(await Bun.file(zip).arrayBuffer())
}

describe('imports', () => {
  it('takes an upload in chunks, unpacks it and works out what it is', async () => {
    const { base, service } = setup()
    const bytes = await serverZip(base)
    const meta = await service.start('/home/me/server.zip', bytes.length)
    expect(meta).toMatchObject({ label: 'server.zip', state: 'receiving', received: 0 })
    const half = Math.floor(bytes.length / 2)
    await service.append(meta.id, 0, body(bytes.slice(0, half)))
    // A retried chunk at the wrong offset is refused, not appended twice.
    await expect(service.append(meta.id, 0, body(bytes.slice(0, half)))).rejects.toThrow(
      'Expected the chunk at',
    )
    const done = await service.append(meta.id, half, body(bytes.slice(half)))
    expect(done.state).toBe('received')

    const job = await service.unpack(meta.id, null).done
    expect(job).toMatchObject({
      state: 'succeeded',
      message: 'Found a Fabric server for Minecraft 26.3.',
    })
    const after = await service.get(meta.id)
    expect(after.state).toBe('ready')
    expect(after.detected).toMatchObject({ kind: 'server', loader: 'fabric', hasMods: true })
    expect(after.detected!.root).toBe(join(service.unpacked(meta.id), 'old-host'))
  })

  it('refuses oversized chunks and a full disk', async () => {
    const { service } = setup({ free: 100 })
    await expect(service.start('x.zip', 1000)).rejects.toThrow('enough free disk space')
    const roomy = setup()
    const meta = await roomy.service.start('x.zip', 10)
    await expect(roomy.service.append(meta.id, 0, body(new Uint8Array(20)))).rejects.toThrow(
      'too big',
    )
    expect((await roomy.service.get(meta.id)).received).toBe(0)
  })

  it('imports from an https link, and refuses plain http', async () => {
    const fake = (async () =>
      new Response(Bun.gzipSync(new Uint8Array(0)))) as unknown as typeof fetch
    const { base, service } = setup({
      fetch: (async (url: URL) => {
        if (String(url) === 'https://example.test/server.zip')
          return new Response(await serverZip(base))
        return fake(url)
      }) as never,
    })
    const meta = await service.start('https://example.test/server.zip', null)
    expect(
      (await service.unpack(meta.id, { url: 'https://example.test/server.zip' }).done) as object,
    ).toMatchObject({
      state: 'succeeded',
    })
    const other = await service.start('http://x', null)
    const failed = (await service.unpack(other.id, { url: 'http://example.test/a.zip' }).done) as {
      message: string
    }
    expect(failed.message).toBe('Only https links can be imported.')
    expect((await service.get(other.id)).state).toBe('failed')
  })

  it('checks every redirect a link leads to', async () => {
    const { base, service } = setup({
      fetch: (async (url: URL) => {
        const u = String(url)
        if (u === 'https://example.test/a')
          return Response.redirect('https://cdn.example.test/b', 302)
        if (u === 'https://cdn.example.test/b') return new Response(await serverZip(base))
        if (u === 'https://example.test/sneaky')
          return Response.redirect('https://127.0.0.1:8443/admin', 302)
        return new Response('no', { status: 404 })
      }) as never,
    })
    const ok = await service.start('https://example.test/a', null)
    expect(
      (await service.unpack(ok.id, { url: 'https://example.test/a' }).done) as object,
    ).toMatchObject({ state: 'succeeded' })
    const bad = await service.start('https://example.test/sneaky', null)
    const failed = (await service.unpack(bad.id, { url: 'https://example.test/sneaky' }).done) as {
      message: string
    }
    expect(failed.message).toBe("Links to this machine or its local network can't be imported.")
  })

  it('stops unpacking a tar.gz that would fill the disk', async () => {
    const { base, service } = setup({ free: 200_000 })
    const src = join(base, 'big')
    mkdirSync(src)
    writeFileSync(join(src, 'zeros'), new Uint8Array(1_000_000))
    mkdirSync(join(base, 'archive'))
    const name = 'big-2026-11-01T10-00-00-000Z.tar.gz'
    Bun.spawnSync(['tar', '-czf', join(base, 'archive', name), '-C', base, 'big'])
    const meta = await service.start(name, null)
    const job = (await service.unpack(meta.id, { archive: name }).done) as { message: string }
    expect(job.message).toBe("There isn't enough free disk space to unpack this import.")
  })

  it('imports a deleted server archive, and refuses Paper', async () => {
    const { base, service } = setup()
    const deleted = join(base, 'gone', 'survival')
    mkdirSync(join(deleted, 'world'), { recursive: true })
    writeFileSync(join(deleted, 'server.properties'), '')
    writeFileSync(join(deleted, 'world', 'level.dat'), levelDat('26.1'))
    mkdirSync(join(base, 'archive'))
    const name = 'survival-2026-11-01T10-00-00-000Z.tar.gz'
    Bun.spawnSync([
      'tar',
      '-czf',
      join(base, 'archive', name),
      '-C',
      join(base, 'gone'),
      'survival',
    ])
    expect((await service.archives()).map((a) => a.name)).toEqual(['survival'])
    const meta = await service.start(name, null)
    expect((await service.unpack(meta.id, { archive: name }).done) as object).toMatchObject({
      state: 'succeeded',
    })
    expect((await service.get(meta.id)).detected?.mcVersion).toBe('26.1')

    writeFileSync(join(deleted, 'paper.yml'), '')
    Bun.spawnSync([
      'tar',
      '-czf',
      join(base, 'archive', name),
      '-C',
      join(base, 'gone'),
      'survival',
    ])
    const paper = await service.start(name, null)
    const failed = (await service.unpack(paper.id, { archive: name }).done) as { message: string }
    expect(failed.message).toContain('Paper')
  })

  it('starts from a past world, and says when it has gone', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ft-imp-past-'))
    const src = join(base, 'season')
    mkdirSync(join(src, 'datapacks'), { recursive: true })
    writeFileSync(join(src, 'level.dat'), levelDat('26.3'))
    const zip = join(base, 'survival-past-world.zip')
    await writeZip(await entriesFor(src, 'Season one'), zip)
    const { service } = setup({ pastWorlds: { 7: zip, 8: join(base, 'missing.zip') } })
    const meta = await service.start('Season one', null)
    expect((await service.unpack(meta.id, { pastWorld: 7 }).done) as object).toMatchObject({
      state: 'succeeded',
    })
    expect((await service.get(meta.id)).detected).toMatchObject({
      kind: 'world',
      mcVersion: '26.3',
    })
    expect(await Bun.file(zip).exists()).toBe(true)

    for (const id of [8, 9]) {
      const gone = await service.start('Gone', null)
      const failed = (await service.unpack(gone.id, { pastWorld: id }).done) as { message: string }
      expect(failed.message).toBe('That past world has gone.')
    }
  })

  it('drops links from uploads and sweeps old imports', async () => {
    const { base, service, tick } = setup()
    const src = join(base, 'linky')
    mkdirSync(join(src, 'w'), { recursive: true })
    writeFileSync(join(src, 'w', 'level.dat'), levelDat('26.3'))
    Bun.spawnSync(['ln', '-s', '/etc/passwd', join(src, 'w', 'sneaky')])
    const tgz = join(base, 'w.tar.gz')
    Bun.spawnSync(['tar', '-czf', tgz, '-C', src, 'w'])
    const bytes = new Uint8Array(await Bun.file(tgz).arrayBuffer())
    const meta = await service.start('w.tar.gz', bytes.length)
    await service.append(meta.id, 0, body(bytes))
    await service.unpack(meta.id, null).done
    expect(await readdir(join(service.unpacked(meta.id), 'w'))).toEqual(['level.dat'])
    tick(STAGE_TTL_MS + 1)
    expect(await service.sweep()).toBe(1)
    await expect(service.get(meta.id)).rejects.toThrow('No such import')
  })
})
