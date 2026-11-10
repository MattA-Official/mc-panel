export default defineEventHandler(async (event) => {
  await requirePermission(event, 'servers.create')
  const { imports, id } = await importContext(event)
  return importHttp(() => imports.get(id))
})
