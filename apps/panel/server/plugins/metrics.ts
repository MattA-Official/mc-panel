// Starts the once-a-minute metrics sampler (after the db plugin, alphabetically).
export default defineNitroPlugin(() => {
  useMetrics().start()
})
