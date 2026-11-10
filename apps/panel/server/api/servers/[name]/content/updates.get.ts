/**
 * Newer compatible versions of installed content, as a ready plan. The result is kept for
 * the update badges too, so the badge and the Content tab always agree.
 */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name, specs } = await specContext(event)
  const plan = await specHttp(async () => specs.plan(name, await specs.currentSpec(name), true))
  const updates = plan.changes.filter((c) => c.action === 'update')
  useUpdates().store('content', name, {
    updates: updates.map((c) => ({ label: c.label, from: c.from, to: c.to })),
  })
  return { plan, updates }
})
