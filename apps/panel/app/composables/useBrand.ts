import type { PublicBranding } from '#shared/branding'

/** Points the page's theme stylesheet and favicon at the current branding. */
function applyToHead(b: PublicBranding) {
  const theme = document.querySelector<HTMLLinkElement>('link[href^="/branding/theme.css"]')
  // A new address makes the browser fetch the stylesheet again, without a reload.
  if (theme) theme.href = `/branding/theme.css?v=${encodeURIComponent(b.accent + b.font)}`
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) icon.href = b.favicon
}

/** The install's name, logo and colours. Loaded once; `refreshBrand` after a change. */
export function useBrand() {
  return useState<PublicBranding | null>('brand', () => null)
}

export async function loadBrand() {
  const brand = useBrand()
  brand.value = await $fetch<PublicBranding>('/api/branding').catch(() => brand.value)
  if (brand.value) applyToHead(brand.value)
}

/** Sets the branding everywhere on this page, from a save or from another tab's change. */
export function setBrand(b: PublicBranding) {
  useBrand().value = b
  applyToHead(b)
}

/** Keeps branding current while signed in: a change made in another tab arrives here. */
export function useLiveBrand() {
  useTopic<PublicBranding>('branding', setBrand)
}

/** The product name to show: the install's own, or Flytower until it has loaded. */
export function useBrandName() {
  const { productName } = useAppConfig()
  const brand = useBrand()
  return computed(() => brand.value?.name ?? productName)
}
