/** Revokes a share link at once. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'backups.download')
  const { user, name } = await backupContext(event)
  const id = Number(getRouterParam(event, 'id'))
  const shareId = Number(getRouterParam(event, 'shareId'))
  backupHttp(() => useExports().revoke(name, id, shareId))
  audit(user.id, 'world.share.revoke', name, { exportId: id, shareId })
  return { revoked: true }
})
