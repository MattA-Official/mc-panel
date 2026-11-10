/** The loaders the wizard can offer. */
export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
  return Object.values(useLoaders()).map((l) => ({ id: l.id, name: l.name }))
})
