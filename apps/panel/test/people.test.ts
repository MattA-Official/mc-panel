import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../server/db'
import { grantRole, loadAccess } from '../server/auth/access'
import {
  acceptInvite,
  checkInvite,
  createInvite,
  INVITE_TTL_MS,
  listPeople,
  ownerCount,
  PeopleError,
  removePerson,
  revokeInvite,
  setGrants,
} from '../server/auth/people'
import { can } from '../shared/permissions'
import { describeAudit } from '../shared/utils/audit'

function setup() {
  const db = openDb(':memory:')
  for (const name of ['survival', 'creative']) {
    db.insert(schema.servers)
      .values({
        name,
        displayName: name,
        loader: 'vanilla',
        mcVersion: '26.3',
        javaMajor: 25,
        memoryMb: 2048,
        port: name === 'survival' ? 25565 : 25566,
        rconPort: name === 'survival' ? 25575 : 25576,
        rconPassword: 'x',
        eulaAcceptedAt: new Date(),
      })
      .run()
  }
  const person = (name: string, role?: string, server: string | null = null) => {
    const id = db.insert(schema.users).values({ name }).returning().get().id
    if (role) grantRole(db, id, role, server)
    return id
  }
  const owner = person('Matt', 'owner')
  const access = (id: number) => loadAccess(db, id)!
  return { db, person, owner, access }
}

const fails = (fn: () => unknown, message: RegExp) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(PeopleError)
    expect((e as Error).message).toMatch(message)
    return
  }
  throw new Error('expected a PeopleError')
}

describe('invites', () => {
  test('a link works once and makes the person with its role', () => {
    const { db, owner, access } = setup()
    const { token } = createInvite(db, access(owner), {
      roleId: 'operator',
      server: 'survival',
      createdBy: owner,
    })
    const found = checkInvite(db, token)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    const { user } = db.transaction((tx) => acceptInvite(tx, found.invite.id, 'Sam'))
    const a = access(user.id)
    expect(can(a, 'server.power', 'survival')).toBe(true)
    expect(can(a, 'server.view', 'creative')).toBe(false)
    expect(checkInvite(db, token)).toEqual({
      ok: false,
      reason: 'This invite link has already been used.',
    })
    expect(() => db.transaction((tx) => acceptInvite(tx, found.invite.id, 'Again'))).toThrow(
      /expired or was cancelled/,
    )
  })

  test('only a hash of the token is stored', () => {
    const { db, owner, access } = setup()
    const { token } = createInvite(db, access(owner), {
      roleId: 'viewer',
      server: null,
      createdBy: owner,
    })
    const row = db.select().from(schema.invites).get()!
    expect(row.tokenHash).not.toContain(token)
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('links expire after 7 days', () => {
    const { db, owner, access } = setup()
    const now = Date.now()
    const { token } = createInvite(
      db,
      access(owner),
      { roleId: 'viewer', server: null, createdBy: owner },
      now,
    )
    expect(checkInvite(db, token, now + INVITE_TTL_MS - 1).ok).toBe(true)
    expect(checkInvite(db, token, now + INVITE_TTL_MS + 1)).toMatchObject({ ok: false })
    expect(listPeople(db, now + INVITE_TTL_MS + 1).invites).toEqual([])
  })

  test('a cancelled link stops working', () => {
    const { db, owner, access } = setup()
    const { id, token } = createInvite(db, access(owner), {
      roleId: 'viewer',
      server: null,
      createdBy: owner,
    })
    revokeInvite(db, id)
    expect(checkInvite(db, token)).toMatchObject({ ok: false })
  })

  test('nobody can invite someone with more access than they have', () => {
    const { db, person, access } = setup()
    // A custom role that can manage people on top of being an Admin everywhere.
    db.insert(schema.roles)
      .values({ id: 'lead', name: 'Lead', permissions: ['people.manage', 'server.view'] })
      .run()
    const lead = person('Lead', 'lead')
    grantRole(db, lead, 'admin', 'survival')
    const a = access(lead)
    fails(
      () => createInvite(db, a, { roleId: 'owner', server: null, createdBy: lead }),
      /more access than you have/,
    )
    fails(
      () => createInvite(db, a, { roleId: 'admin', server: 'creative', createdBy: lead }),
      /more access than you have/,
    )
    expect(
      createInvite(db, a, { roleId: 'admin', server: 'survival', createdBy: lead }).token,
    ).toBeString()
  })
})

describe('changing and removing people', () => {
  test('the last Owner cannot be demoted or removed', () => {
    const { db, owner, person, access } = setup()
    fails(
      () => setGrants(db, access(owner), owner, [{ roleId: 'viewer', server: null }]),
      /at least one Owner/,
    )
    const other = person('Sam', 'owner')
    setGrants(db, access(owner), owner, [{ roleId: 'admin', server: null }])
    expect(ownerCount(db)).toBe(1)
    fails(() => removePerson(db, access(owner), other, owner), /more access than you/)
    fails(() => removePerson(db, access(other), other, other), /yourself/)
  })

  test('an Owner on one server is not an Owner of the install', () => {
    const { db, owner, access } = setup()
    fails(
      () => setGrants(db, access(owner), owner, [{ roleId: 'owner', server: 'survival' }]),
      /at least one Owner/,
    )
  })

  test('a change applies on the next request, and duplicates are dropped', () => {
    const { db, owner, person, access } = setup()
    const sam = person('Sam', 'viewer', 'survival')
    setGrants(db, access(owner), sam, [
      { roleId: 'operator', server: 'survival' },
      { roleId: 'operator', server: 'survival' },
      { roleId: 'viewer', server: null },
    ])
    expect(db.select().from(schema.grants).where(eq(schema.grants.userId, sam)).all()).toHaveLength(
      2,
    )
    expect(can(access(sam), 'console.read', 'survival')).toBe(true)
    expect(can(access(sam), 'server.view', 'creative')).toBe(true)
  })

  test('removing someone ends their access and takes their passkeys', () => {
    const { db, owner, person, access } = setup()
    const sam = person('Sam', 'operator', 'survival')
    db.insert(schema.credentials)
      .values({ id: 'cred', userId: sam, publicKey: Buffer.from('k'), nickname: 'Phone' })
      .run()
    removePerson(db, access(owner), sam, owner)
    expect(loadAccess(db, sam)).toBeNull()
    expect(db.select().from(schema.credentials).all()).toEqual([])
  })

  test('the list shows people, open invites and roles', () => {
    const { db, owner, person, access } = setup()
    person('Sam', 'viewer', 'creative')
    createInvite(db, access(owner), {
      roleId: 'operator',
      server: 'survival',
      note: 'Alex',
      createdBy: owner,
    })
    const list = listPeople(db)
    expect(list.people.map((p) => [p.name, p.grants])).toEqual([
      ['Matt', [{ roleId: 'owner', server: null }]],
      ['Sam', [{ roleId: 'viewer', server: 'creative' }]],
    ])
    expect(list.invites).toMatchObject([{ note: 'Alex', invitedBy: 'Matt', roleId: 'operator' }])
    expect(list.roles.map((r) => r.id)).toEqual(['owner', 'admin', 'operator', 'viewer'])
  })
})

test('activity describes people changes', () => {
  expect(
    describeAudit('people.invited', null, { person: 'Sam', role: 'operator', server: 'survival' }),
  ).toBe('Made an invite link for Sam (Operator on survival)')
  expect(describeAudit('people.joined', null, { role: 'viewer', server: null })).toBe(
    'Joined as Viewer on all servers',
  )
  expect(describeAudit('people.removed', null, { person: 'Sam' })).toBe('Removed Sam')
})

describe('custom roles', () => {
  test('a custom role can be made, given out and changed', async () => {
    const { saveRole } = await import('../server/auth/people')
    const { db, owner, person, access } = setup()
    const mod = saveRole(db, access(owner), {
      name: 'Moderator',
      permissions: ['players.manage', 'console.read'],
    })
    // Seeing the server comes with anything done on it.
    expect(mod.permissions).toEqual(['server.view', 'console.read', 'players.manage'])
    const sam = person('Sam', mod.id, 'survival')
    expect(can(access(sam), 'players.manage', 'survival')).toBe(true)
    saveRole(db, access(owner), { id: mod.id, name: 'Moderator', permissions: ['server.view'] })
    expect(can(access(sam), 'players.manage', 'survival')).toBe(false)
  })

  test('names are unique, built-in roles are fixed, and nobody makes a role beyond themselves', async () => {
    const { saveRole } = await import('../server/auth/people')
    const { db, owner, person, access } = setup()
    fails(
      () => saveRole(db, access(owner), { name: 'admin', permissions: ['server.view'] }),
      /already a role/,
    )
    fails(
      () =>
        saveRole(db, access(owner), {
          id: 'viewer',
          name: 'Watcher',
          permissions: ['server.view'],
        }),
      /Built-in roles/,
    )
    const adminAll = person('Ada', 'admin')
    fails(
      () => saveRole(db, access(adminAll), { name: 'Boss', permissions: ['system.manage'] }),
      /more access than you have/,
    )
  })

  test('a role in use cannot be deleted; deleting an unused one cancels its invites', async () => {
    const { saveRole, deleteRole } = await import('../server/auth/people')
    const { db, owner, person, access } = setup()
    const mod = saveRole(db, access(owner), { name: 'Moderator', permissions: ['players.manage'] })
    const sam = person('Sam', mod.id, 'survival')
    fails(() => deleteRole(db, access(owner), mod.id), /1 person has this role/)
    setGrants(db, access(owner), sam, [{ roleId: 'viewer', server: 'survival' }])
    createInvite(db, access(owner), { roleId: mod.id, server: null, createdBy: owner })
    deleteRole(db, access(owner), mod.id)
    expect(db.select().from(schema.invites).all()).toEqual([])
    fails(() => deleteRole(db, access(owner), 'owner'), /Built-in roles/)
  })
})
