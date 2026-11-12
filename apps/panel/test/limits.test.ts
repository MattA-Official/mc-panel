/** Size caps and other limits on things that come from outside: logs, level.dat, links. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { fetchLink, isLocalAddress, MAX_REDIRECTS } from '../server/imports/fetch-link'
import { readNbt } from '../server/imports/nbt'
import { MAX_LOG_BYTES, readLog } from '../server/logs'
import { run } from '../server/spawn'
import { editInTurn } from '../server/utils/server-files'

describe('size caps', () => {
  it('refuses a gzipped log that unpacks past the cap, without unpacking it all', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ft-limits-'))
    mkdirSync(join(root, 'logs'))
    writeFileSync(
      join(root, 'logs', 'big.log.gz'),
      Bun.gzipSync(new Uint8Array(MAX_LOG_BYTES * 4).fill(0x61)),
    )
    await expect(readLog(root, 'big.log.gz')).rejects.toThrow('too big to show')
  })

  it('refuses a level.dat that unpacks past the cap', () => {
    expect(() => readNbt(Bun.gzipSync(new Uint8Array(64 * 1024 * 1024)))).toThrow('far too big')
  })
})

describe('import links', () => {
  it('knows local addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.4',
      '172.20.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isLocalAddress(ip)).toBe(true)
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111'])
      expect(isLocalAddress(ip)).toBe(false)
  })

  const publicDns = async () => ['93.184.216.34']

  it('refuses names that resolve to the local network', async () => {
    await expect(
      fetchLink(new URL('https://intranet.example/x'), {
        lookup: async () => ['10.0.0.5'],
        fetch: (async () => new Response('x')) as never,
      }),
    ).rejects.toThrow('local network')
  })

  it('refuses a redirect to plain http and too many redirects', async () => {
    await expect(
      fetchLink(new URL('https://a.example/'), {
        lookup: publicDns,
        fetch: (async () => Response.redirect('http://a.example/plain', 301)) as never,
      }),
    ).rejects.toThrow('Only https links')
    let hops = 0
    await expect(
      fetchLink(new URL('https://a.example/0'), {
        lookup: publicDns,
        fetch: (async () => Response.redirect(`https://a.example/${++hops}`, 302)) as never,
      }),
    ).rejects.toThrow('redirects too many times')
    expect(hops).toBe(MAX_REDIRECTS + 1)
  })
})

describe('running commands', () => {
  it("reads a long error output while the command runs, so it can't hang", async () => {
    const r = await run(['sh', '-c', 'head -c 1000000 /dev/zero | tr "\\0" x >&2; exit 3'])
    expect(r.code).toBe(3)
    expect(r.stderr.length).toBe(16 * 1024)
  })
})

describe('editing server files', () => {
  it('runs edits of one file one at a time', async () => {
    const order: string[] = []
    const edit = (name: string, ms: number) =>
      editInTurn('/srv/x/server.properties', async () => {
        order.push(`${name} start`)
        await Bun.sleep(ms)
        order.push(`${name} end`)
      })
    await Promise.all([edit('a', 20), edit('b', 1)])
    expect(order).toEqual(['a start', 'a end', 'b start', 'b end'])
  })
})
