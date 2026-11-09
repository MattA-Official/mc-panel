/** Deletes one backup. */
export default defineEventHandler(async (event) => {
  const { user, name, service } = await backupContext(event)
  const { id } = getRouterParams(event)
  const row = await backupHttp(() => service.remove(name, Number(id)))
  audit(user.id, 'backup.delete', name, { file: row.file })
  return { deleted: row.file }
})
