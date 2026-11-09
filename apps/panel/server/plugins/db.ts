import { importTokenFile, needsSetup, setTokenPlain } from '../auth/setup-token'

// Open the database at boot so a failed migration stops the panel starting, instead of
// surfacing on the first request. Then pick up a setup token from the installer.
export default defineNitroPlugin(async () => {
  const db = useDb()
  const { setupTokenFile, devSetupToken } = useRuntimeConfig()
  if (!needsSetup(db)) return
  if (importTokenFile(db, setupTokenFile)) {
    console.log('[flytower] setup token imported from the installer')
  } else if (import.meta.dev && devSetupToken) {
    await setTokenPlain(db, devSetupToken)
    console.log('[flytower] development setup token set from NUXT_DEV_SETUP_TOKEN')
  }
})
