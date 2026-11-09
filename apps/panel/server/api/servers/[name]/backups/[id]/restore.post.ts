/** Restores a backup over the server. Needs a recent passkey check. */
export default defineEventHandler(async (event) => {
  await requireElevated(event)
  const { user, name, service } = await backupContext(event)
  const { id } = getRouterParams(event)
  const { jobId } = backupHttp(() => service.restore(name, Number(id)))
  audit(user.id, 'backup.restore', name, { id: Number(id), jobId })
  useStatus().poke()
  return { jobId }
})
