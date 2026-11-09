import { fabricProvider } from './fabric.ts'
import { Mojang, vanillaProvider } from './mojang.ts'
import type { Fetch, LoaderId, LoaderProvider } from './types.ts'

export * from './types.ts'
export { downloadVerified } from './download.ts'
export { dashed, lookupPlayer, offlineUuid, PLAYER_NAME, type PlayerProfile } from './players.ts'

/** The built-in, trusted loader providers. */
export function createLoaders(
  fetchImpl: Fetch = globalThis.fetch,
): Record<LoaderId, LoaderProvider> {
  const mojang = new Mojang(fetchImpl)
  return { vanilla: vanillaProvider(mojang), fabric: fabricProvider(fetchImpl, mojang) }
}
export * from './content.ts'
export { modrinthProvider, rankVersions } from './modrinth.ts'
export { resolveUrl, type UrlRef } from './url.ts'
export { resolveAll, type ResolvedSet, type WantedContent } from './resolve.ts'
export {
  parseCategories,
  requestDownload,
  vanillaTweaksProvider,
  vtVersions,
  type TweakType,
  type VanillaTweaksProvider,
  type VtCatalogue,
  type VtCategory,
  type VtPack,
} from './vanillatweaks.ts'
