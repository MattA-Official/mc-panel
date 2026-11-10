import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../server/db'
import { grantRole, loadAccess } from '../server/auth/access'
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  can,
  foldGrants,
  type Access,
  type BuiltInRole,
} from '../shared/permissions'
import { ROUTE_PERMISSIONS } from './helpers/route-permissions'

const API = join(import.meta.dir, '../server/api')

function routeFiles(dir = API): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? routeFiles(p) : p.endsWith('.ts') ? [relative(API, p)] : []
  })
}

describe('every API route checks a permission', () => {
  const files = routeFiles()

  test('the table lists every route, and only real ones', () => {
    expect(files.filter((f) => !(f in ROUTE_PERMISSIONS))).toEqual([])
    expect(Object.keys(ROUTE_PERMISSIONS).filter((f) => !files.includes(f))).toEqual([])
  })

  test.each(Object.entries(ROUTE_PERMISSIONS))('%s checks %s', (file, permission) => {
    const src = readFileSync(join(API, file), 'utf8')
    if (permission === 'open') {
      // Answered before sign-in: must sit under a prefix the auth middleware opens.
      expect(file).toMatch(
        /^(auth|setup|public|join)\/|^passkeys\/register|^(branding|health)\.get\.ts$|^ws\.ts$/,
      )
      return
    }
    if (permission === 'signed-in') {
      expect(src).toMatch(/require(SignedIn|Permission|ServerPermission)\(event/)
      return
    }
    const serverScoped = file.startsWith('servers/[name]/') && !permission.includes('servers.')
    const call = serverScoped
      ? `requireServerPermission(event, '${permission}')`
      : `requirePermission(event, '${permission}')`
    expect(src).toContain(call)
    // The check comes before anything else the handler does.
    const body = src.slice(src.indexOf('defineEventHandler('))
    expect(body.split('\n')[1]).toContain(call)
  })

  test('the table only names real permissions', () => {
    const named = new Set(Object.values(ROUTE_PERMISSIONS))
    for (const p of named) {
      if (p === 'open' || p === 'signed-in') continue
      expect(ALL_PERMISSIONS as readonly string[]).toContain(p)
    }
  })
})

const roleOn = (role: BuiltInRole, server: string | null): Access =>
  foldGrants([{ permissions: BUILT_IN_ROLES[role].permissions, server }])

describe('built-in roles', () => {
  test('Owner can do everything everywhere', () => {
    const a = roleOn('owner', null)
    for (const p of ALL_PERMISSIONS) expect(can(a, p, 'survival')).toBe(true)
  })

  test('Viewers see status and players only, never the console', () => {
    const a = roleOn('viewer', 'survival')
    expect(can(a, 'server.view', 'survival')).toBe(true)
    expect(can(a, 'console.read', 'survival')).toBe(false)
    expect(can(a, 'server.power', 'survival')).toBe(false)
    expect(can(a, 'server.view', 'creative')).toBe(false)
  })

  test('Operators run the server but cannot touch files, settings or downloads', () => {
    const a = roleOn('operator', 'survival')
    for (const p of [
      'server.power',
      'console.read',
      'console.command',
      'players.manage',
      'backups.create',
    ] as const) {
      expect(can(a, p, 'survival')).toBe(true)
    }
    for (const p of [
      'files.read',
      'server.configure',
      'backups.download',
      'backups.restore',
      'server.delete',
    ] as const) {
      expect(can(a, p, 'survival')).toBe(false)
    }
  })

  test('Admins for one server cannot create servers or manage the install', () => {
    const one = roleOn('admin', 'survival')
    expect(can(one, 'server.delete', 'survival')).toBe(true)
    expect(can(one, 'servers.create')).toBe(false)
    expect(can(one, 'people.manage')).toBe(false)
    const all = roleOn('admin', null)
    expect(can(all, 'servers.create')).toBe(true)
    expect(can(all, 'system.manage')).toBe(false)
    expect(can(all, 'people.manage')).toBe(false)
    expect(can(all, 'activity.all')).toBe(false)
  })

  test('grants add up', () => {
    const a = foldGrants([
      { permissions: BUILT_IN_ROLES.viewer.permissions, server: null },
      { permissions: BUILT_IN_ROLES.operator.permissions, server: 'survival' },
    ])
    expect(can(a, 'server.view', 'creative')).toBe(true)
    expect(can(a, 'server.power', 'creative')).toBe(false)
    expect(can(a, 'server.power', 'survival')).toBe(true)
  })

  test('install permissions only count on grants for all servers', () => {
    const a = foldGrants([{ permissions: ['servers.create', 'server.view'], server: 'survival' }])
    expect(can(a, 'servers.create')).toBe(false)
    expect(a.servers.survival).toEqual(['server.view'])
  })
})

describe('access from the database', () => {
  const setup = () => {
    const db = openDb(':memory:')
    const user = (name: string) => db.insert(schema.users).values({ name }).returning().get().id
    db.insert(schema.servers)
      .values({
        name: 'survival',
        displayName: 'Survival',
        loader: 'vanilla',
        mcVersion: '26.3',
        javaMajor: 25,
        memoryMb: 2048,
        port: 25565,
        rconPort: 25575,
        rconPassword: 'x',
        eulaAcceptedAt: new Date(),
      })
      .run()
    return { db, user }
  }

  test('the migration adds the built-in roles', () => {
    const { db } = setup()
    const ids = db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .all()
      .map((r) => r.id)
    expect(ids.sort()).toEqual(['admin', 'operator', 'owner', 'viewer'])
  })

  test('a person with no grants can do nothing', () => {
    const { db, user } = setup()
    const access = loadAccess(db, user('Alex'))!
    expect(access).toEqual({ all: [], servers: {} })
  })

  test('a removed person has no access at all', () => {
    const { db, user } = setup()
    const id = user('Alex')
    grantRole(db, id, 'owner')
    db.delete(schema.users).where(eq(schema.users.id, id)).run()
    expect(loadAccess(db, id)).toBeNull()
    expect(db.select().from(schema.grants).all()).toEqual([])
  })

  test('a role change takes effect on the next read', () => {
    const { db, user } = setup()
    const id = user('Alex')
    grantRole(db, id, 'viewer', 'survival')
    expect(can(loadAccess(db, id)!, 'server.power', 'survival')).toBe(false)
    db.update(schema.grants).set({ roleId: 'operator' }).where(eq(schema.grants.userId, id)).run()
    expect(can(loadAccess(db, id)!, 'server.power', 'survival')).toBe(true)
  })

  test('deleting a server removes grants for it', () => {
    const { db, user } = setup()
    const id = user('Alex')
    grantRole(db, id, 'operator', 'survival')
    db.delete(schema.servers).where(eq(schema.servers.name, 'survival')).run()
    expect(loadAccess(db, id)).toEqual({ all: [], servers: {} })
  })

  test('built-in roles take their permissions from code, not the stored column', () => {
    const { db, user } = setup()
    const id = user('Alex')
    grantRole(db, id, 'viewer', 'survival')
    db.update(schema.roles)
      .set({ permissions: ['server.delete'] })
      .where(eq(schema.roles.id, 'viewer'))
      .run()
    expect(loadAccess(db, id)!.servers.survival).toEqual(['server.view'])
  })
})
