/** Notification channels, without their addresses' secret parts or tokens. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  return useNotify().channels()
})
