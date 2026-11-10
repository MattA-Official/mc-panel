/** What the background update check last found. The `updates` WebSocket topic sends the same. */
export default defineEventHandler(async (event) => {
  await requireSignedIn(event)
  return useUpdates().snapshot()
})
