// Once at boot, every server's squaremap config is checked against its map settings, in case
// it was edited by hand or came back with a restore.
export default defineNitroPlugin((nitro) => {
  const t = setTimeout(() => void useMap().syncAll(), 10_000)
  t.unref?.()
  nitro.hooks.hook('close', () => clearTimeout(t))
})
