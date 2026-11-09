export default defineEventHandler(async (event) => {
  const { imports, id } = await importContext(event)
  await importHttp(() => imports.get(id))
  await imports.remove(id)
  return { deleted: true }
})
