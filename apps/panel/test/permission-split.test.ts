import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { migrate } from '../server/db'
import { migrations } from '../server/db/migrations.gen'
import { rolePermissions } from '../server/auth/access'
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  can,
  expandPermissions,
  foldGrants,
  type Access,
  type Permission,
  withImplied,
} from '../shared/permissions'
import * as v1 from './fixtures/permissions-v1'
import { ROUTE_PERMISSIONS } from './helpers/route-permissions'
import { SERVER_PERMISSIONS } from '../shared/permissions'

const SERVER_KEYS = new Set<string>(SERVER_PERMISSIONS)
import { ROUTE_PERMISSIONS_V1 } from './fixtures/route-permissions-v1'

describe('expandPermissions and withImplied', () => {
  test('saving adds what a permission needs', () => {
    expect(withImplied(['console.command'])).toEqual([
      'server.view',
      'console.read',
      'console.command',
    ])
    expect(withImplied(['files.write'])).toEqual(['server.view', 'files.read', 'files.write'])
    expect(withImplied(['people.manage'])).toEqual(['people.invite', 'people.manage'])
  })

  test('the YAML brings every kind of setting', () => {
    expect(withImplied(['spec.edit'])).toEqual([
      'server.view',
      'backups.schedule',
      'settings.edit',
      'content.manage',
      'schedules.manage',
      'community.manage',
      'spec.edit',
    ])
  })

  test('reading a role adds seeing the server but nothing else', () => {
    // A role saved before 1.4.0 keeps exactly what it had.
    expect(expandPermissions(['console.command'])).toEqual(['server.view', 'console.command'])
  })

  test('install permissions alone do not add seeing servers', () => {
    expect(expandPermissions(['servers.create'])).toEqual(['servers.create'])
  })

  test('swaps retired keys and drops unknown ones', () => {
    expect(expandPermissions(['system.manage', 'nonsense'])).toEqual([
      'system.updates',
      'system.notifications',
      'system.integrations',
      'system.branding',
      'system.ssh',
    ])
    expect(expandPermissions(['server.configure'])).toContain('content.manage')
  })

  test('built-in roles are already complete', () => {
    for (const r of Object.values(BUILT_IN_ROLES)) {
      expect(withImplied(r.permissions)).toEqual(r.permissions)
    }
  })
})

// ----------------------------------------------------------------------------- migration

/** A database as 1.3.0 left it, with these custom roles, then upgraded. */
function upgrade(roles: Record<string, readonly string[]>) {
  const sqlite = new Database(':memory:')
  migrate(
    sqlite,
    migrations.filter((m) => m.tag < '0022'),
  )
  const add = sqlite.prepare(
    'INSERT INTO roles (id, name, built_in, permissions) VALUES (?, ?, 0, ?)',
  )
  for (const [id, permissions] of Object.entries(roles))
    add.run(id, id, JSON.stringify(permissions))
  migrate(sqlite)
  const stored = Object.fromEntries(
    sqlite
      .query<{ id: string; permissions: string }, []>('SELECT id, permissions FROM roles')
      .all()
      .map((r) => [r.id, JSON.parse(r.permissions) as string[]]),
  )
  const audit = sqlite
    .query<{ action: string; detail: string }, []>('SELECT action, detail FROM audit')
    .all()
  return { stored, audit }
}

describe('migration 0022', () => {
  test('rewrites old keys in custom roles and leaves others alone', () => {
    const { stored, audit } = upgrade({
      configurer: ['server.view', 'server.configure'],
      boss: ['system.manage', 'people.manage'],
      plain: ['server.view', 'server.power'],
    })
    expect(stored.configurer!.sort()).toEqual(
      [
        'server.view',
        'spec.edit',
        'settings.edit',
        'content.manage',
        'schedules.manage',
        'community.manage',
        'backups.schedule',
      ].sort(),
    )
    expect(stored.boss!.sort()).toEqual(
      [
        'people.invite',
        'people.manage',
        'roles.manage',
        'system.branding',
        'system.integrations',
        'system.notifications',
        'system.ssh',
        'system.updates',
      ].sort(),
    )
    expect(stored.plain).toEqual(['server.view', 'server.power'])
    // Built-in rows take their permissions from code and stay as they were.
    expect(stored.owner).toEqual([])
    expect(audit).toEqual([{ action: 'people.permissions_split', detail: '{"roles":3}' }])
  })

  test('a fresh install gets no Activity entry', () => {
    expect(upgrade({}).audit).toEqual([])
  })
})

// ---------------------------------------------------------------------------- equivalence

/** Old roles as saveRole made them: anything on a server came with seeing it. */
function oldRole(keys: readonly v1.Permission[]): v1.Permission[] {
  const set = new Set(keys)
  if (keys.some(v1.isServerPermission)) set.add('server.view')
  return v1.ALL_PERMISSIONS.filter((p) => set.has(p))
}

/** A small seeded generator, so a failure can be reproduced. */
function random(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
    return seed / 2 ** 31
  }
}

const samples: v1.Permission[][] = [
  ...Object.values(v1.BUILT_IN_ROLES).map((r) => r.permissions),
  ...v1.ALL_PERMISSIONS.map((p) => [p]),
]
const next = random(126)
for (let i = 0; i < 300; i++) {
  samples.push(v1.ALL_PERMISSIONS.filter(() => next() < 0.3))
}
const roles = samples.map(oldRole).filter((r) => r.length)

const KEYED = Object.entries(ROUTE_PERMISSIONS_V1).filter(
  ([, p]) => p !== 'open' && p !== 'signed-in',
) as [string, v1.Permission][]

/** Plan and apply check spec sections now; holding all of them is what server.configure was. */
const SPEC_ROUTES = new Set(['servers/[name]/plan.post.ts', 'servers/[name]/apply.post.ts'])

function newDecision(access: Access, file: string, server: string | undefined) {
  if (SPEC_ROUTES.has(file)) return can(access, 'spec.edit', server)
  const key = ROUTE_PERMISSIONS[file] as Permission
  return can(access, key, server)
}

describe('nobody gains or loses access in the upgrade', () => {
  const ids = roles.map((_, i) => `r${i}`)
  const { stored } = upgrade(Object.fromEntries(roles.map((r, i) => [ids[i]!, r])))

  test('every keyed route is in both tables', () => {
    for (const [file] of KEYED) expect(ROUTE_PERMISSIONS[file]).toBeDefined()
  })

  test.each([null, 'survival'] as const)('on every route, for grants on %s', (grantServer) => {
    let checked = 0
    roles.forEach((old, i) => {
      const before = v1.foldGrants([{ permissions: old, server: grantServer }])
      const after = foldGrants([
        {
          permissions: rolePermissions({ id: ids[i]!, permissions: stored[ids[i]!]! }),
          server: grantServer,
        },
      ])
      for (const [file, oldKey] of KEYED) {
        const scoped = file.startsWith('servers/[name]/') && !oldKey.includes('servers.')
        for (const server of scoped ? ['survival', 'creative'] : [undefined]) {
          const was = v1.can(before, oldKey, server)
          const now = newDecision(after, file, server)
          if (was !== now) {
            throw new Error(
              `${file} on ${server ?? 'install'} for [${old.join(', ')}]: ${was} → ${now}`,
            )
          }
          checked++
        }
      }
      // Mapping Discord roles needed both old keys, and needs both new ones.
      expect(v1.can(before, 'people.manage') && v1.can(before, 'system.manage')).toBe(
        can(after, 'roles.manage') && can(after, 'system.integrations'),
      )
    })
    expect(checked).toBeGreaterThan(10_000)
  })

  test('built-in roles keep their reach', () => {
    for (const id of ['owner', 'admin', 'operator', 'viewer'] as const) {
      const before = v1.foldGrants([
        { permissions: v1.BUILT_IN_ROLES[id].permissions, server: null },
      ])
      const after = foldGrants([{ permissions: BUILT_IN_ROLES[id].permissions, server: null }])
      for (const [file, oldKey] of KEYED) {
        expect(newDecision(after, file, 'survival')).toBe(v1.can(before, oldKey, 'survival'))
      }
    }
    expect(BUILT_IN_ROLES.owner.permissions).toEqual([...ALL_PERMISSIONS])
  })
})

describe('role editor helpers', () => {
  test('every permission is in exactly one area', async () => {
    const { PERMISSION_AREAS } = await import('../shared/permissions')
    const listed = PERMISSION_AREAS.flatMap((a) => a.permissions)
    expect([...listed].sort()).toEqual([...ALL_PERMISSIONS].sort())
    for (const a of PERMISSION_AREAS) {
      for (const p of a.permissions) expect(a.install).toBe(!SERVER_KEYS.has(p))
    }
  })

  test('says which permission brings each implied one', async () => {
    const { impliedBy } = await import('../shared/permissions')
    expect(impliedBy(['spec.edit'])).toMatchObject({
      'settings.edit': 'spec.edit',
      'content.manage': 'spec.edit',
      'server.view': 'spec.edit',
    })
    expect(impliedBy(['console.command'])).toEqual({
      'console.read': 'console.command',
      'server.view': 'console.command',
    })
    expect(impliedBy(['servers.create'])).toEqual({})
  })
})
