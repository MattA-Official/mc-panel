/** A server's past worlds (old worlds kept at a reset) and their live share links. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name } = await backupContext(event)
  return useExports()
    .pastWorlds(name)
    .map(({ id, name, bytes, createdAt, shares }) => ({
      id,
      name,
      bytes,
      createdAt,
      shares: shares.map(({ id, createdAt, expiresAt, downloads }) => ({
        id,
        createdAt,
        expiresAt,
        downloads,
      })),
    }))
})
