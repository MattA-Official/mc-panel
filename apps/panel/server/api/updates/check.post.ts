/** Checks everything for updates now, in the background. Results arrive on the `updates` topic. */
export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
  const updates = useUpdates()
  void updates.checkAll().catch((err) => console.error('[flytower] update check failed', err))
  return { checking: updates.checking() }
})
