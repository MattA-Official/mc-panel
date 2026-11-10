import { BrandingError, BrandingStore } from '../branding'

let store: BrandingStore | undefined

/** The one branding store for this process. Changes go out to open tabs on `branding`. */
export function useBranding(): BrandingStore {
  store ??= new BrandingStore({
    db: useDb(),
    onChange: (b) => useJobs().bus.publish('branding', b),
  })
  return store
}

/** Runs `fn`, turning a BrandingError into a 400. */
export function brandingHttp<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof BrandingError)
      throw createError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
}
