/** Whether Chunky can run on this server, and its progress. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'server.view')
  const { name, world } = await worldContext(event)
  return worldHttp(() => world.pregenStatus(name))
})
