export default defineEventHandler(async (event) => {
  await requirePermission(event, 'servers.create')
  const { imports, id } = await importContext(event)
  await importHttp(() => imports.get(id))
  await imports.remove(id)
  return { deleted: true }
})
