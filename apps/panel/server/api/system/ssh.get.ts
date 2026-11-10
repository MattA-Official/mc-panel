/** Whether SSH gets through the firewall, and when an emergency opening ends. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system.manage')
  try {
    return await agent('ssh.status', {}, { timeoutMs: 10_000 })
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }
})
