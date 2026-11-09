/** Archives of deleted servers that can be imported again. */
export default defineEventHandler(async (event) => {
  const { imports } = await importContext(event)
  return imports.archives()
})
