export default defineEventHandler(async (event) => {
  const { user, name } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const row = await backupHttp(() => useExports().remove(name, id))
  audit(user.id, 'world.export.delete', name, { file: row.file })
  return { deleted: true }
})
