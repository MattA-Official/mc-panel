/** Newer compatible versions of installed content, as a ready plan. */
export default defineEventHandler(async (event) => {
  const { name, specs } = await specContext(event)
  const plan = await specHttp(async () => specs.plan(name, await specs.currentSpec(name), true))
  return { plan, updates: plan.changes.filter((c) => c.action === 'update') }
})
