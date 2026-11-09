// Open the database at boot so a failed migration stops the panel starting,
// instead of surfacing on the first request.
export default defineNitroPlugin(() => {
  useDb()
})
