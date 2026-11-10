export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'backups.download')
  const { name } = await backupContext(event)
  const exports = useExports()
  const row = backupHttp(() => exports.get(name, Number(getRouterParam(event, 'id'))))
  return zipResponse(
    exports.path(row),
    row.name ? `${row.name}.zip` : `${findServer(name).displayName} world.zip`,
  )
})
