import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { appendFile, rename, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { ConsoleHub, type ConsoleMessage } from '../server/console/hub'
import { LogTailer } from '../server/console/tailer'

/** Waits until `check` passes, for reads that follow inotify. */
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await Bun.sleep(5)
  }
}

function tailerIn(seedBytes?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'ft-tail-'))
  const path = join(dir, 'latest.log')
  const seen: string[] = []
  const tailer = new LogTailer(path, (l) => seen.push(...l), { pollMs: 60_000, seedBytes })
  return { path, seen, tailer }
}

describe('LogTailer', () => {
  it('follows growth and holds back half-written lines', async () => {
    const { path, seen, tailer } = tailerIn()
    await writeFile(path, 'one\r\ntwo\n')
    await tailer.start()
    expect(seen).toEqual(['one', 'two'])
    await appendFile(path, 'thr')
    await tailer.tick()
    expect(seen).toEqual(['one', 'two'])
    await appendFile(path, 'ee\nfour\n')
    await tailer.tick()
    expect(seen).toEqual(['one', 'two', 'three', 'four'])
    tailer.stop()
  })

  it('waits for a file that does not exist yet', async () => {
    const { path, seen, tailer } = tailerIn()
    await tailer.start()
    await tailer.tick()
    await writeFile(path, 'Starting minecraft server\n')
    await tailer.tick()
    expect(seen).toEqual(['Starting minecraft server'])
    tailer.stop()
  })

  it('starts over after truncation', async () => {
    const { path, seen, tailer } = tailerIn()
    await writeFile(path, 'old line\n')
    await tailer.start()
    await truncate(path, 0)
    await tailer.tick()
    await appendFile(path, 'new\n')
    await tailer.tick()
    expect(seen).toEqual(['old line', 'new'])
    tailer.stop()
  })

  it('follows a rotation to the new file', async () => {
    const { path, seen, tailer } = tailerIn()
    await writeFile(path, 'yesterday\n')
    await tailer.start()
    await rename(path, path + '.1')
    // Longer than the old file, so only the inode gives the rotation away.
    await writeFile(path, 'today, first line\nsecond\n')
    await tailer.tick()
    expect(seen).toEqual(['yesterday', 'today, first line', 'second'])
    tailer.stop()
  })

  it('reads again when asked while a read is running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-tail-'))
    const path = join(dir, 'latest.log')
    await writeFile(path, '')
    const seen: string[] = []
    let first = true
    const tailer = new LogTailer(
      path,
      (l) => {
        seen.push(...l)
        if (!first) return
        first = false
        // The server writes the next line while this read is still going, and the watcher
        // asks for another read before this one has finished.
        appendFileSync(path, 'joined\n')
        void tailer.tick()
      },
      { pollMs: 0 },
    )
    await tailer.start()
    await appendFile(path, 'logged in\n')
    await tailer.tick()
    expect(seen).toEqual(['logged in', 'joined'])
  })

  it('carries on when the log disappears mid-read', async () => {
    const { path, seen, tailer } = tailerIn()
    await writeFile(path, 'one\n')
    await tailer.start()
    const { rm } = await import('node:fs/promises')
    await rm(path)
    await tailer.tick()
    await writeFile(path, 'two\n')
    await tailer.tick()
    expect(seen).toEqual(['one', 'two'])
  })

  it('logs a failed read instead of rejecting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-tail-'))
    // A folder where the log should be: stat works, open and read don't.
    mkdirSync(join(dir, 'latest.log'))
    const tailer = new LogTailer(join(dir, 'latest.log'), () => {}, { pollMs: 0 })
    const errors: unknown[] = []
    const was = console.error
    console.error = (...a: unknown[]) => void errors.push(a)
    try {
      await tailer.start()
      await tailer.tick()
    } finally {
      console.error = was
    }
    expect(errors.length).toBeGreaterThan(0)
  })

  it('seeds only the tail of a big log, without a cut line', async () => {
    const { path, seen, tailer } = tailerIn(20)
    await writeFile(path, 'a long early line\nmiddle\nlast one\n')
    await tailer.start()
    expect(seen).toEqual(['middle', 'last one'])
    tailer.stop()
  })
})

describe('ConsoleHub', () => {
  function hub(reply = 'There are 0 of a max of 20 players online:') {
    const dir = mkdtempSync(join(tmpdir(), 'ft-hub-'))
    mkdirSync(join(dir, 'survival', 'logs'), { recursive: true })
    const sent: string[] = []
    let connects = 0
    const h = new ConsoleHub({
      serversDir: dir,
      rconTarget: (n) => (n === 'survival' ? { port: 1, password: 'p' } : null),
      connect: async () => {
        connects++
        return {
          isOpen: true,
          close() {},
          command: async (c: string) => {
            sent.push(c)
            if (c === 'boom') throw new Error('broken pipe')
            return `§6${reply}`
          },
        }
      },
    })
    return { h, dir, sent, connects: () => connects }
  }

  it('sends a snapshot, then live lines, then stops tailing', async () => {
    const { h, dir } = hub()
    const log = join(dir, 'survival', 'logs', 'latest.log')
    await writeFile(log, '[Server thread/INFO]: Done (3.2s)!\n')
    const a: ConsoleMessage[] = []
    const offA = h.watch('survival', (m) => a.push(m))
    await until(() => a.flatMap((m) => m.lines).includes('[Server thread/INFO]: Done (3.2s)!'))
    expect(a[0]).toEqual({ type: 'snapshot', lines: [] })
    // New lines arrive through inotify, with nothing polling.
    await appendFile(log, 'live line\n')
    await until(() => a.flatMap((m) => m.lines).includes('live line'))

    const b: ConsoleMessage[] = []
    const offB = h.watch('survival', (m) => b.push(m))
    expect(b[0]).toEqual({
      type: 'snapshot',
      lines: ['[Server thread/INFO]: Done (3.2s)!', 'live line'],
    })
    offA()
    offB()
    await appendFile(log, 'after\n')
    await Bun.sleep(30)
    expect(b.flatMap((m) => m.lines)).not.toContain('after')
  })

  it('runs commands over one connection and echoes them to consoles', async () => {
    const { h, sent, connects } = hub()
    const seen: ConsoleMessage[] = []
    const off = h.watch('survival', (m) => seen.push(m))
    expect(await h.command('survival', 'list')).toBe('There are 0 of a max of 20 players online:')
    await h.command('survival', 'seed')
    expect(sent).toEqual(['list', 'seed'])
    expect(connects()).toBe(1)
    expect(seen.flatMap((m) => m.lines)).toContain('> list')
    off()
  })

  it('reconnects after a failed command', async () => {
    const { h, connects } = hub()
    await expect(h.command('survival', 'boom')).rejects.toThrow('broken pipe')
    await h.command('survival', 'list')
    expect(connects()).toBe(2)
  })

  it('shares one connection between commands that arrive together', async () => {
    const { h, connects } = hub()
    await Promise.all([h.command('survival', 'list'), h.command('survival', 'seed')])
    expect(connects()).toBe(1)
  })

  it('replaces a closed connection only once when callers arrive together', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ft-hub-'))
    let connects = 0
    const clients: { isOpen: boolean }[] = []
    const h = new ConsoleHub({
      serversDir: dir,
      rconTarget: () => ({ port: 1, password: 'p' }),
      connect: async () => {
        connects++
        const c = { isOpen: true, close() {}, command: async () => 'ok' }
        clients.push(c)
        return c
      },
    })
    await h.command('survival', 'list')
    clients[0]!.isOpen = false
    await Promise.all([1, 2, 3].map(() => h.command('survival', 'list')))
    expect(connects).toBe(2)
  })

  it('refuses unknown servers', async () => {
    const { h } = hub()
    await expect(h.command('nope', 'list')).rejects.toThrow('No server called nope.')
  })
})
