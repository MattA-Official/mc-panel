import { rm } from 'node:fs/promises'
import { ICON_FILE } from '../../../icon'
import { resolveInside } from '../../../files'
import { schema } from '../../../db'

/** Removes the server's icon, so the multiplayer list shows the default after a restart. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'settings.edit')
  const ctx = await fileContext(event)
  await fileAction(ctx, null, {}, async () =>
    rm(await resolveInside(ctx.root, ICON_FILE), { force: true }),
  )
  useDb()
    .insert(schema.audit)
    .values({
      userId: ctx.user.id,
      action: 'server.icon',
      target: ctx.name,
      detail: { removed: true },
    })
    .run()
  return { icon: null }
})
