import type { Db, DbOrTx } from '../db'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import {
  BUILT_IN_ROLES,
  foldGrants,
  isBuiltInRole,
  type Access,
  type Permission,
} from '../../shared/permissions'

/** The permissions a role carries: built-in roles from code, custom roles from the database. */
export function rolePermissions(role: { id: string; permissions: Permission[] }): Permission[] {
  return isBuiltInRole(role.id) ? BUILT_IN_ROLES[role.id].permissions : role.permissions
}

/**
 * What a person can do right now, read from the database on every request so a change of
 * role or a removal takes effect at once. Null when the person no longer exists.
 */
export function loadAccess(db: Db, userId: number, sessionVersion = 0): Access | null {
  const user = db
    .select({ id: schema.users.id, sessionVersion: schema.users.sessionVersion })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()
  // Gone, or signed out everywhere since this session began.
  if (!user || user.sessionVersion !== sessionVersion) return null
  const rows = db
    .select({
      server: schema.grants.server,
      roleId: schema.roles.id,
      permissions: schema.roles.permissions,
    })
    .from(schema.grants)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.grants.roleId))
    .where(eq(schema.grants.userId, userId))
    .all()
  return foldGrants(
    rows.map((r) => ({
      server: r.server,
      permissions: rolePermissions({ id: r.roleId, permissions: r.permissions }),
    })),
  )
}

/** Gives a person a role, for one server or (null) all servers. */
export function grantRole(
  db: DbOrTx,
  userId: number,
  roleId: string,
  server: string | null = null,
) {
  db.insert(schema.grants).values({ userId, roleId, server }).run()
}
