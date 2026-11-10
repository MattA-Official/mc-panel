/** What the background update check last found. The `updates` WebSocket topic sends the same. */
export default defineEventHandler(async (event) => {
  const { access } = await requireSignedIn(event)
  return visibleUpdates(useUpdates().snapshot(), access)
})
