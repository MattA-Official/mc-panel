import { and, asc, count, eq, isNull, ne } from 'drizzle-orm'
import { schema, type Db, type DbOrTx } from '../db'
import { can, isServerPermission, type Access } from '../../shared/permissions'
import { grantRole, rolePermissions } from './access'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000

/** Shown to the person as-is. */
export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface GrantInput {
  roleId: string
  /** A server's name, or null for all servers. */
  server: string | null
}

const sha256 = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex')

function role(db: DbOrTx, id: string) {
  const r = db.select().from(schema.roles).where(eq(schema.roles.id, id)).get()
  if (!r) throw new PeopleError('That role no longer exists.')
  return r
}

function serverExists(db: DbOrTx, name: string) {
  return Boolean(
    db
      .select({ name: schema.servers.name })
      .from(schema.servers)
      .where(eq(schema.servers.name, name))
      .get(),
  )
}

/**
 * Whether someone with `access` may hand out `roleId` for `server`: only what they could do
 * there themselves, so nobody can make someone else more powerful than they are.
 */
export function mayGrant(db: DbOrTx, access: Access, g: GrantInput): boolean {
  // On one server, only server permissions count (see foldGrants).
  const perms = rolePermissions(role(db, g.roleId)).filter(
    (p) => g.server === null || isServerPermission(p),
  )
  return perms.every((p) => can(access, p, g.server ?? undefined))
}

function checkGrant(db: DbOrTx, access: Access, g: GrantInput) {
  if (g.server !== null && !serverExists(db, g.server)) {
    throw new PeopleError('That server no longer exists.')
  }
  if (!mayGrant(db, access, g)) {
    throw new PeopleError("You can't give someone more access than you have.", 403)
  }
}

/** How many people own the install, leaving out `except`. */
export function ownerCount(db: DbOrTx, except?: number): number {
  return (
    db
      .select({ n: count() })
      .from(schema.grants)
      .where(
        and(
          eq(schema.grants.roleId, 'owner'),
          isNull(schema.grants.server),
          except === undefined ? undefined : ne(schema.grants.userId, except),
        ),
      )
      .get()?.n ?? 0
  )
}

// ------------------------------------------------------------------------------ invites

/** Makes a one-time invite. The token is returned once and never stored. */
export function createInvite(
  db: Db,
  access: Access,
  input: GrantInput & { note?: string | null; createdBy: number },
  now = Date.now(),
) {
  checkGrant(db, access, input)
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const row = db
    .insert(schema.invites)
    .values({
      tokenHash: sha256(token),
      roleId: input.roleId,
      server: input.server,
      note: input.note?.trim() || null,
      createdBy: input.createdBy,
      expiresAt: new Date(now + INVITE_TTL_MS),
    })
    .returning()
    .get()
  return { id: row.id, token, expiresAt: row.expiresAt }
}

export type InviteCheck =
  { ok: true; invite: typeof schema.invites.$inferSelect } | { ok: false; reason: string }

/** Looks an invite up by its token. */
export function checkInvite(db: DbOrTx, token: string, now = Date.now()): InviteCheck {
  const invite = db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, sha256(token.trim())))
    .get()
  if (!invite) {
    return { ok: false, reason: "This invite link isn't valid. It may have been cancelled." }
  }
  if (invite.usedAt) return { ok: false, reason: 'This invite link has already been used.' }
  if (invite.expiresAt.getTime() < now) {
    return { ok: false, reason: 'This invite link has expired. Ask for a new one.' }
  }
  return { ok: true, invite }
}

/** Re-checks invite `id` by id (the session holds the id, not the token). */
export function inviteById(db: DbOrTx, id: number, now = Date.now()) {
  const invite = db.select().from(schema.invites).where(eq(schema.invites.id, id)).get()
  if (!invite || invite.usedAt || invite.expiresAt.getTime() < now) return null
  return invite
}

/** What the person opening the link is told before they join. */
export function describeInvite(db: DbOrTx, invite: typeof schema.invites.$inferSelect) {
  const r = role(db, invite.roleId)
  const server = invite.server
    ? db
        .select({ displayName: schema.servers.displayName })
        .from(schema.servers)
        .where(eq(schema.servers.name, invite.server))
        .get()
    : null
  const by = invite.createdBy
    ? db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, invite.createdBy))
        .get()
    : null
  return {
    role: r.name,
    server: server?.displayName ?? null,
    invitedBy: by?.name ?? null,
    expiresAt: invite.expiresAt,
  }
}

/** Joins: makes the person and their grant, and uses the invite up. Run inside a transaction. */
export function acceptInvite(tx: DbOrTx, inviteId: number, name: string, now = Date.now()) {
  const invite = inviteById(tx, inviteId, now)
  if (!invite) throw new PeopleError('This invite link has expired or was cancelled.', 410)
  const user = tx.insert(schema.users).values({ name }).returning().get()
  grantRole(tx, user.id, invite.roleId, invite.server)
  tx.update(schema.invites)
    .set({ usedAt: new Date(now), usedBy: user.id })
    .where(eq(schema.invites.id, invite.id))
    .run()
  return { user, invite }
}

export function revokeInvite(db: Db, id: number) {
  const invite = db.select().from(schema.invites).where(eq(schema.invites.id, id)).get()
  if (!invite || invite.usedAt) throw new PeopleError('No such invite.', 404)
  db.delete(schema.invites).where(eq(schema.invites.id, id)).run()
  return invite
}

// ------------------------------------------------------------------------------- people

/** Replaces everything a person can do. The install always keeps at least one Owner. */
export function setGrants(db: Db, access: Access, userId: number, grants: GrantInput[]) {
  for (const g of grants) checkGrant(db, access, g)
  // Taking access away needs the same standing as giving it.
  for (const g of currentGrants(db, userId)) {
    if (!mayGrant(db, access, g)) {
      throw new PeopleError("You can't change someone who has more access than you.", 403)
    }
  }
  const keepsOwner = grants.some((g) => g.roleId === 'owner' && g.server === null)
  if (!keepsOwner && ownerCount(db, userId) === 0) {
    throw new PeopleError('Flytower needs at least one Owner. Make someone else an Owner first.')
  }
  db.transaction((tx) => {
    tx.delete(schema.grants).where(eq(schema.grants.userId, userId)).run()
    // The same role twice for the same place adds nothing.
    const seen = new Set<string>()
    for (const g of grants) {
      const key = `${g.roleId}\u0000${g.server ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      grantRole(tx, userId, g.roleId, g.server)
    }
  })
}

export function currentGrants(db: DbOrTx, userId: number): GrantInput[] {
  return db
    .select({ roleId: schema.grants.roleId, server: schema.grants.server })
    .from(schema.grants)
    .where(eq(schema.grants.userId, userId))
    .all()
}

/** Removes a person. Their passkeys, codes and grants go with them, which signs them out. */
export function removePerson(db: Db, access: Access, userId: number, self: number) {
  if (userId === self) throw new PeopleError("You can't remove yourself.")
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!user) throw new PeopleError('No such person.', 404)
  for (const g of currentGrants(db, userId)) {
    if (!mayGrant(db, access, g)) {
      throw new PeopleError("You can't remove someone who has more access than you.", 403)
    }
  }
  if (ownerCount(db) > 0 && ownerCount(db, userId) === 0) {
    throw new PeopleError("Flytower needs at least one Owner, so the last one can't be removed.")
  }
  db.delete(schema.users).where(eq(schema.users.id, userId)).run()
  return user
}

/** Everyone, their grants, open invites and the roles there are, for the People page. */
export function listPeople(db: Db, now = Date.now()) {
  const users = db.select().from(schema.users).orderBy(asc(schema.users.createdAt)).all()
  const grants = db.select().from(schema.grants).all()
  const passkeys = db
    .select({ userId: schema.credentials.userId, lastUsedAt: schema.credentials.lastUsedAt })
    .from(schema.credentials)
    .all()
  const roles = db.select().from(schema.roles).orderBy(asc(schema.roles.createdAt)).all()
  const invites = db
    .select()
    .from(schema.invites)
    .where(isNull(schema.invites.usedAt))
    .orderBy(asc(schema.invites.createdAt))
    .all()
    .filter((i) => i.expiresAt.getTime() >= now)
  const names = new Map(users.map((u) => [u.id, u.name]))
  return {
    people: users.map((u) => {
      const keys = passkeys.filter((p) => p.userId === u.id)
      const last = Math.max(0, ...keys.map((k) => k.lastUsedAt?.getTime() ?? 0))
      return {
        id: u.id,
        name: u.name,
        joinedAt: u.createdAt,
        lastSignIn: last ? new Date(last) : null,
        passkeys: keys.length,
        grants: grants
          .filter((g) => g.userId === u.id)
          .map((g) => ({ roleId: g.roleId, server: g.server })),
      }
    }),
    invites: invites.map((i) => ({
      id: i.id,
      roleId: i.roleId,
      server: i.server,
      note: i.note,
      invitedBy: i.createdBy ? (names.get(i.createdBy) ?? null) : null,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      builtIn: r.builtIn,
      permissions: rolePermissions(r),
    })),
  }
}
