/** Deletes one backup, and its off-site copy. Can't be undone, so it needs a passkey check. */
export default defineEventHandler(async (event) => {
  await requireElevated(event)
  const { user, name, service } = await backupContext(event)
  const { id } = getRouterParams(event)
  const row = await backupHttp(() => service.remove(name, Number(id)))
  audit(user.id, 'backup.delete', name, { file: row.file })
  return { deleted: row.file }
})
