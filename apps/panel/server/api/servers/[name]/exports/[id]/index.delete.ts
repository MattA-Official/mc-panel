/**
 * Deletes an export or a past world. A past world is often the only copy of a world a reset
 * replaced, so like deleting a backup it needs a passkey check.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'backups.delete')
  await requireElevated(event)
  const { user, name } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const row = await backupHttp(() => useExports().remove(name, id))
  audit(user.id, 'world.export.delete', name, { file: row.file })
  return { deleted: true }
})
