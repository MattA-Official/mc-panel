/** Starts a world export; progress follows on `job:<id>`. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'world.manage')
  const { user, name } = await backupContext(event)
  const server = findServer(name)
  const { jobId } = backupHttp(() => useExports().export(name, server.displayName))
  audit(user.id, 'world.export', name, { jobId })
  return { jobId }
})
