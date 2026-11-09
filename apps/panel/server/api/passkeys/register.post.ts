import { z } from 'zod'
import { PasskeyError, saveCredential, verifyRegistration } from '../../auth/passkeys'
import { issueCodes } from '../../auth/recovery'
import { markTokenUsed, needsSetup } from '../../auth/setup-token'
import { audit as auditTable, users } from '../../db/schema'

const Body = z.object({
  attemptId: z.string().min(1).max(100),
  nickname: z.string().max(60).default('Passkey'),
  name: z.string().trim().min(1).max(60).optional(),
  response: z.custom<Parameters<typeof verifyRegistration>[2]>(
    (v) => typeof v === 'object' && v !== null,
  ),
})

export default defineEventHandler(async (event) => {
  const db = useDb()
  const session = await getUserSession(event)
  const body = await readValidatedBody(event, Body.parse)
  const firstRun = needsSetup(db)
  if (firstRun && !session.setupVerified) {
    throw createError({ statusCode: 403, statusMessage: 'Enter the setup token first.' })
  }
  if (!firstRun && !session.user)
    throw createError({ statusCode: 401, statusMessage: 'Sign in first.' })
  if (!firstRun && !session.mustEnrolPasskey) await requireElevated(event)

  let cred
  try {
    cred = await verifyRegistration(relyingParty(event), body.attemptId, body.response)
  } catch (e) {
    if (e instanceof PasskeyError) throw createError({ statusCode: 400, statusMessage: e.message })
    throw e
  }

  if (firstRun) {
    const user = db.transaction((tx) => {
      // Re-check inside the transaction so two racing tabs cannot both become owner.
      if (!needsSetup(tx))
        throw createError({ statusCode: 409, statusMessage: 'Setup is already done.' })
      const u = tx
        .insert(users)
        .values({ name: body.name ?? 'Owner' })
        .returning()
        .get()
      saveCredential(tx, u.id, cred, body.nickname)
      markTokenUsed(tx)
      tx.insert(auditTable).values({ userId: u.id, action: 'setup.completed' }).run()
      return u
    })
    const recoveryCodes = await issueCodes(db, user.id)
    await replaceUserSession(event, { user: { id: user.id, name: user.name } })
    return { recoveryCodes }
  }

  saveCredential(db, session.user!.id, cred, body.nickname)
  db.insert(auditTable)
    .values({
      userId: session.user!.id,
      action: 'passkey.added',
      detail: { nickname: body.nickname },
    })
    .run()
  await replaceUserSession(event, { user: session.user!, elevatedUntil: session.elevatedUntil })
  return { recoveryCodes: null }
})
