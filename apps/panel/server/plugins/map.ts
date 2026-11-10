// The web map: starts watching every server whose map is on, and catches up on anything
// saved while the panel was down. Runs after db.
export default defineNitroPlugin((nitro) => {
  const map = useMap()
  void map.start()
  nitro.hooks.hook('close', () => map.stop())
})
