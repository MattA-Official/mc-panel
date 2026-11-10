/** Archives of deleted servers that can be imported again. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'servers.create')
  const { imports } = await importContext(event)
  return imports.archives()
})
