export default defineEventHandler(async (event) => {
  const { name } = await backupContext(event)
  const exports = useExports()
  const row = backupHttp(() => exports.get(name, Number(getRouterParam(event, 'id'))))
  return zipResponse(exports.path(row), `${findServer(name).displayName} world.zip`)
})
