/** Notification channels, without their addresses' secret parts or tokens. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.notifications')
  return useNotify().channels()
})
