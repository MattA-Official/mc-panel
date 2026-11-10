import { beforeEach, describe, expect, it } from 'bun:test'
import { openDb, schema, type Db } from '../server/db'
import { parseUuidLine, Sessions, UUID_TTL_MS } from '../server/stats/sessions'

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
const ALEX = '853c80ef-3c37-49fd-aa49-938b674adae6'

const line = (msg: string, thread = 'Server thread') => `[12:34:56] [${thread}/INFO]: ${msg}`
const uuidLine = (name: string, uuid: string) =>
  line(`UUID of player ${name} is ${uuid}`, 'User Authenticator #1')

let db: Db
let clock: number
let cache: Record<string, string>
let s: Sessions

beforeEach(() => {
  db = openDb(':memory:')
  clock = Date.parse('2026-11-10T18:00:00Z')
  cache = {}
  s = new Sessions({
    db,
    lookupUuid: async (_server, name) => cache[name.toLowerCase()] ?? null,
    now: () => clock,
  })
})

const rows = () => db.select().from(schema.playerSessions).all()
const join = async (name: string, uuid: string, server = 'survival') => {
  s.line(server, uuidLine(name, uuid))
  await s.observe(server, { kind: 'joined', player: name })
}
const minutes = (n: number) => (clock += n * 60_000)

describe('parseUuidLine', () => {
  it('reads the login line from vanilla, Fabric and Paper', () => {
    expect(parseUuidLine(uuidLine('Steve_99', STEVE))).toEqual({ name: 'Steve_99', uuid: STEVE })
    expect(parseUuidLine(`[12:34:56 INFO]: UUID of player Alex is ${ALEX.toUpperCase()}`)).toEqual({
      name: 'Alex',
      uuid: ALEX,
    })
  })

  it('ignores chat and system chat pretending to be one', () => {
    expect(parseUuidLine(line(`<Bob> UUID of player Steve is ${STEVE}`))).toBeNull()
    expect(parseUuidLine(line(`System chat: UUID of player Steve is ${STEVE}`))).toBeNull()
    expect(parseUuidLine(line(`[Server] UUID of player Steve is ${STEVE}`))).toBeNull()
    expect(parseUuidLine(line(`UUID of player Steve is ${STEVE} really`))).toBeNull()
  })
})

describe('Sessions', () => {
  it('records a visit from join to leave, with the UUID from the login line', async () => {
    await join('Steve', STEVE)
    minutes(30)
    await s.observe('survival', { kind: 'left', player: 'Steve' })
    const [r] = rows()
    expect(r).toMatchObject({ server: 'survival', uuid: STEVE, name: 'Steve', endedBy: 'left' })
    expect(r!.leftAt!.getTime() - r!.joinedAt.getTime()).toBe(30 * 60_000)
    const [p] = s.summary('survival')
    expect(p).toMatchObject({ uuid: STEVE, name: 'Steve', sessions: 1, online: false })
    expect(p!.playtimeMs).toBe(30 * 60_000)
  })

  it('falls back to usercache.json when the login line is missing or old', async () => {
    cache.alex = ALEX
    await s.observe('survival', { kind: 'joined', player: 'Alex' })
    s.line('survival', uuidLine('Steve', STEVE))
    clock += UUID_TTL_MS + 1
    cache.steve = 'from-cache'
    await s.observe('survival', { kind: 'joined', player: 'Steve' })
    expect(rows().map((r) => r.uuid)).toEqual([ALEX, 'from-cache'])
  })

  it("skips a player whose UUID can't be found", async () => {
    await s.observe('survival', { kind: 'joined', player: 'Ghost' })
    expect(rows()).toEqual([])
  })

  it('adds up visits and counts the current one up to now', async () => {
    await join('Steve', STEVE)
    minutes(10)
    await s.observe('survival', { kind: 'left', player: 'Steve' })
    minutes(60)
    await join('Steve', STEVE)
    minutes(5)
    const [p] = s.summary('survival')
    expect(p).toMatchObject({ sessions: 2, online: true, playtimeMs: 15 * 60_000 })
    expect(p!.lastSeen).toBe(clock)
  })

  it('keeps the newest name for a UUID', async () => {
    await join('Steve', STEVE)
    await s.observe('survival', { kind: 'left', player: 'Steve' })
    await join('Steve2', STEVE)
    expect(s.summary('survival')[0]!.name).toBe('Steve2')
  })

  it('ends everyone when the server stops', async () => {
    await join('Steve', STEVE)
    await join('Alex', ALEX)
    minutes(20)
    await s.observe('survival', { kind: 'stopping' })
    expect(rows().map((r) => r.endedBy)).toEqual(['stopped', 'stopped'])
    expect(rows().every((r) => r.leftAt!.getTime() === clock)).toBe(true)
  })

  it('ends a crashed visit at the last minute the metrics saw anyone on', async () => {
    await join('Steve', STEVE)
    const start = clock / 1000
    db.insert(schema.metrics)
      .values([
        { server: 'survival', at: start + 60, players: 1 },
        { server: 'survival', at: start + 120, players: 1 },
        { server: 'survival', at: start + 180, players: 0 },
      ])
      .run()
    minutes(30)
    await s.crashed('survival')
    const [r] = rows()
    expect(r!.endedBy).toBe('crashed')
    expect(r!.leftAt!.getTime()).toBe((start + 180) * 1000)
  })

  it('never ends a lost visit before it began', async () => {
    await join('Steve', STEVE)
    minutes(30)
    await s.observe('survival', { kind: 'ready' })
    const [r] = rows()
    expect(r!.endedBy).toBe('lost')
    expect(r!.leftAt!.getTime()).toBe(r!.joinedAt.getTime())
  })

  it('ends an older visit when the same player joins again without leaving', async () => {
    await join('Steve', STEVE)
    minutes(5)
    await join('Steve', STEVE)
    expect(rows().map((r) => r.endedBy)).toEqual(['rejoined', null])
  })

  it('keeps servers apart', async () => {
    await join('Steve', STEVE, 'survival')
    await join('Steve', STEVE, 'creative')
    await s.observe('creative', { kind: 'stopping' })
    expect(s.summary('survival')[0]!.online).toBe(true)
    expect(s.summary('creative')[0]!.online).toBe(false)
  })

  it('lines up open visits with who is on when the panel starts', async () => {
    cache.steve = STEVE
    cache.alex = ALEX
    await join('Steve', STEVE)
    await join('Alex', ALEX)
    minutes(10)
    // While the panel was down, Steve left and Notch joined; Alex is still on.
    cache.notch = 'notch-uuid'
    await s.reconcile('survival', ['Alex', 'Notch'])
    const byName = Object.fromEntries(rows().map((r) => [r.name, r]))
    expect(byName.Steve!.endedBy).toBe('lost')
    expect(byName.Alex!.leftAt).toBeNull()
    expect(byName.Notch!.leftAt).toBeNull()
  })

  it('ends every open visit when the server is not running at boot', async () => {
    await join('Steve', STEVE)
    await s.reconcile('survival', null)
    expect(rows()[0]!.endedBy).toBe('lost')
  })

  it('handles a leave that arrives while its join is still looking up the UUID', async () => {
    let release!: () => void
    const slow = new Sessions({
      db,
      lookupUuid: () => new Promise((r) => (release = () => r(STEVE))),
      now: () => clock,
    })
    void slow.observe('survival', { kind: 'joined', player: 'Steve' })
    void slow.observe('survival', { kind: 'left', player: 'Steve' })
    await Bun.sleep(1)
    release()
    await slow.idle()
    expect(rows()[0]!.endedBy).toBe('left')
  })

  it('forgets a deleted server', async () => {
    await join('Steve', STEVE)
    s.forget('survival')
    expect(rows()).toEqual([])
    expect(db.select().from(schema.playerNames).all()).toEqual([])
  })
})
