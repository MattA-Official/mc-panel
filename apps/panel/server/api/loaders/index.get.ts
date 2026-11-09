/** The loaders the wizard can offer. */
export default defineEventHandler(() =>
  Object.values(useLoaders()).map((l) => ({ id: l.id, name: l.name })),
)
