/** Measures every server again in the background; the System page reloads when it's done. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  await useDiskUsage().refresh()
  return { ok: true }
})
