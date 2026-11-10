import { SkinCache } from '../skins/cache'

let cache: SkinCache | undefined

/** The one skin cache for this process. */
export function useSkins(): SkinCache {
  cache ??= new SkinCache({ dir: useRuntimeConfig().skinsDir })
  return cache
}
