/** A server's world exports and their live share links (without tokens). */
export default defineEventHandler(async (event) => {
  const { name } = await backupContext(event)
  return useExports()
    .list(name)
    .map(({ id, bytes, createdAt, expiresAt, shares }) => ({
      id,
      bytes,
      createdAt,
      expiresAt,
      shares: shares.map(({ id, createdAt, expiresAt, downloads }) => ({
        id,
        createdAt,
        expiresAt,
        downloads,
      })),
    }))
})
