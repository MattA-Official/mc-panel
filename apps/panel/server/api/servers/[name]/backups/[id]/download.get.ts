/** The backup file itself. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'backups.download')
  const { name, service } = await backupContext(event)
  const { id } = getRouterParams(event)
  const row = backupHttp(() => service.get(name, Number(id)))
  const file = Bun.file(service.path(row))
  if (!(await file.exists()))
    throw createError({ statusCode: 404, statusMessage: 'No such backup.' })
  return new Response(file, {
    headers: {
      'content-type': 'application/zstd',
      'content-length': String(file.size),
      'content-disposition': `attachment; filename="${row.file}"`,
    },
  })
})
