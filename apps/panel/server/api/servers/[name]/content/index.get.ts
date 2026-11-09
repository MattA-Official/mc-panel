/** Installed content, what was asked for, and files added by hand. */
export default defineEventHandler(async (event) => {
  const { name, specs } = await specContext(event)
  return specHttp(() => specs.content(name))
})
