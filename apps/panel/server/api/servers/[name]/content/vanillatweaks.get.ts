/** The Vanilla Tweaks catalogue for this server's Minecraft version. */
export default defineEventHandler(async (event) => {
  await requireServerPermission(event, 'content.manage')
  const { name } = await specContext(event)
  const row = findServer(name)
  const catalogue = await providerCall(() => useVanillaTweaks().catalogue(row.mcVersion))
  return {
    version: catalogue.version,
    datapacks: catalogue.datapacks,
    crafting: catalogue.crafting,
  }
})
