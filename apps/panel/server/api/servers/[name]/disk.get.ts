/** What this server has on disk, by group, from the last background measurement. */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const row = findServer(getRouterParam(event, 'name') ?? '')
  const disk = useDiskUsage()
  const fullness = diskFullness()
  return { ...fullness, usage: disk.server(row.name), measuring: disk.current().measuring }
})
