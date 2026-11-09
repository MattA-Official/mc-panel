/** Liveness for the installer, the release smoke test and the System page. Never throws. */
export default defineEventHandler(async () => {
  const { version } = useRuntimeConfig()
  try {
    const ping = await agent('ping', {}, { timeoutMs: 3_000 })
    return { version, agent: { ok: true as const, version: ping.agentVersion } }
  } catch {
    return { version, agent: { ok: false as const, version: null } }
  }
})
