export default defineEventHandler(async (event) => {
  const { imports, id } = await importContext(event)
  return importHttp(() => imports.get(id))
})
