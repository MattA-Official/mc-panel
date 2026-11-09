/** Whether Chunky can run on this server, and its progress. */
export default defineEventHandler(async (event) => {
  const { name, world } = await worldContext(event)
  return worldHttp(() => world.pregenStatus(name))
})
