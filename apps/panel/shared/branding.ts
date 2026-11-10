/**
 * Branding: the install's own name, accent colour, display font and logo. Shared by the
 * browser (the System form's live preview) and the panel (the generated stylesheet), so the
 * colour maths and the contrast checks are the same on both sides.
 */

export const DEFAULT_NAME = 'Flytower'
/** Tungsten 400, Flytower's own amber. */
export const DEFAULT_ACCENT = '#f2a93b'

export const FONTS = {
  'big-shoulders': {
    label: 'Big Shoulders Display',
    family: "'Big Shoulders Display Variable', 'Big Shoulders Display', 'Arial Narrow', sans-serif",
    weight: 800,
    uppercase: true,
    tracking: '0.02em',
  },
  'plex-sans': {
    label: 'IBM Plex Sans',
    family: "'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif",
    weight: 700,
    uppercase: false,
    tracking: '0',
  },
  fraunces: {
    label: 'Fraunces (serif)',
    family: "'Fraunces Variable', Georgia, serif",
    weight: 700,
    uppercase: false,
    tracking: '0',
  },
  'space-grotesk': {
    label: 'Space Grotesk',
    family: "'Space Grotesk Variable', system-ui, sans-serif",
    weight: 700,
    uppercase: false,
    tracking: '-0.01em',
  },
} as const
export type FontId = keyof typeof FONTS
export const DEFAULT_FONT: FontId = 'big-shoulders'

/** What's saved. Missing fields mean Flytower's own. */
export interface BrandingSettings {
  name: string
  /** `#rrggbb`. */
  accent: string
  font: FontId
  /** Shows "Powered by Flytower" when the name isn't Flytower. */
  poweredBy: boolean
}

export const DEFAULT_BRANDING: BrandingSettings = {
  name: DEFAULT_NAME,
  accent: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  poweredBy: true,
}

export type ImageSlot = 'logo' | 'favicon'
export type ImageType = 'image/svg+xml' | 'image/png'
/** Uploaded images are cleaned, then refused above this size. */
export const MAX_IMAGE_BYTES = 256 * 1024
/** PNGs larger than this on either side are refused. */
export const MAX_PNG_SIDE = 1024

/** What anyone can read, signed in or not: the sign-in page and status page need it. */
export interface PublicBranding extends BrandingSettings {
  /** True when nothing has been changed from Flytower's own. */
  isDefault: boolean
  /** URLs with a version in the query, so caches never show an old logo. */
  logo: string
  favicon: string
  /** Whether a logo is uploaded (the default is Flytower's batten mark). */
  customLogo: boolean
  /** Whether a favicon is uploaded, rather than using the logo or Flytower's. */
  customFavicon: boolean
  /** The shade of the accent used for each mode; see `pickShades`. */
  shades: { light: string; dark: string }
}

export const NAME_MAX = 40

export function isHex(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s)
}

export function normaliseHex(s: string): string | null {
  const t = s.trim().toLowerCase()
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const long = /^#?([0-9a-f]{6})$/.exec(t)
  return long ? `#${long[1]}` : null
}

// ---- Colour maths: sRGB <-> OKLab/OKLCH (Björn Ottosson's matrices) ----

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as Rgb
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export interface Oklch {
  l: number
  c: number
  h: number
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180)
  const B = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)

/** The nearest sRGB colour, keeping lightness and hue and giving up chroma until it fits. */
export function oklchToHex(colour: Oklch): string {
  let lo = 0
  let hi = colour.c
  if (!inGamut(oklchToLinear(colour))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...colour, c: mid }))) lo = mid
      else hi = mid
    }
    hi = lo
  }
  return rgbToHex(oklchToLinear({ ...colour, c: hi }).map(fromLinear) as Rgb)
}

// ---- The scale ----

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
export type Shade = (typeof SHADES)[number]

/** Lightness of each step, close to Tailwind's and the hand-made tungsten scale. */
const LIGHTNESS: Record<Shade, number> = {
  50: 0.98,
  100: 0.95,
  200: 0.9,
  300: 0.84,
  400: 0.77,
  500: 0.69,
  600: 0.6,
  700: 0.51,
  800: 0.44,
  900: 0.38,
  950: 0.27,
}
/** How much of the colour's chroma each step keeps: pale and deep ends are calmer. */
const CHROMA: Record<Shade, number> = {
  50: 0.2,
  100: 0.4,
  200: 0.65,
  300: 0.85,
  400: 1,
  500: 1,
  600: 0.95,
  700: 0.85,
  800: 0.75,
  900: 0.65,
  950: 0.55,
}

/** Which step the accent itself lands on: the one nearest its lightness. */
export function baseShade(accent: string): Shade {
  const { l } = hexToOklch(accent)
  return SHADES.reduce((best, s) =>
    Math.abs(LIGHTNESS[s] - l) < Math.abs(LIGHTNESS[best] - l) ? s : best,
  )
}

/** A full 50 to 950 scale around the accent, with the accent itself exactly on its step. */
export function buildScale(accent: string): Record<Shade, string> {
  const hex = normaliseHex(accent) ?? DEFAULT_ACCENT
  const { c, h } = hexToOklch(hex)
  const base = baseShade(hex)
  const out = {} as Record<Shade, string>
  for (const s of SHADES) {
    out[s] = s === base ? hex : oklchToHex({ l: LIGHTNESS[s], c: c * CHROMA[s], h })
  }
  return out
}

// ---- Contrast (WCAG 2.x) ----

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** AA for normal-size text. */
export const MIN_CONTRAST = 4.5

/**
 * What primary has to read against in each mode: the page and card backgrounds, and the
 * text on a solid primary button (white in light mode, steel 900 in dark).
 */
export const SURFACES = {
  light: ['#ffffff', '#f5f7fa'],
  dark: ['#10151f', '#1b2231'],
} as const

export interface ShadePick {
  shade: Shade
  hex: string
  /** The lowest ratio against that mode's surfaces. */
  ratio: number
}

export interface ShadePicks {
  light: ShadePick | null
  dark: ShadePick | null
}

/**
 * For each mode, the step nearest the accent's own that reads at AA against every surface.
 * Null means no step does, so the colour can't be used.
 */
export function pickShades(accent: string): ShadePicks {
  const scale = buildScale(accent)
  const base = SHADES.indexOf(baseShade(accent))
  const pick = (surfaces: readonly string[]): ShadePick | null => {
    const ordered = [...SHADES].sort(
      (a, b) =>
        Math.abs(SHADES.indexOf(a) - base) - Math.abs(SHADES.indexOf(b) - base) ||
        SHADES.indexOf(a) - SHADES.indexOf(b),
    )
    for (const shade of ordered) {
      const ratio = Math.min(...surfaces.map((s) => contrast(scale[shade], s)))
      if (ratio >= MIN_CONTRAST) return { shade, hex: scale[shade], ratio }
    }
    return null
  }
  return { light: pick(SURFACES.light), dark: pick(SURFACES.dark) }
}

/** Why an accent can't be used, or null when it can. */
export function accentProblem(accent: string): string | null {
  const hex = normaliseHex(accent)
  if (!hex) return 'Use a colour like #2f6fd0.'
  const picks = pickShades(hex)
  if (!picks.light && !picks.dark) return 'No shade of that colour is readable in either mode.'
  if (!picks.light) return 'No shade of that colour is readable on the light background.'
  if (!picks.dark) return 'No shade of that colour is readable on the dark background.'
  return null
}

/** Fills in defaults and drops anything unknown, for settings read back from the database. */
export function withDefaults(saved: Partial<BrandingSettings> | undefined): BrandingSettings {
  const name = typeof saved?.name === 'string' && saved.name.trim() ? saved.name.trim() : null
  const accent = typeof saved?.accent === 'string' ? normaliseHex(saved.accent) : null
  const font = saved?.font && saved.font in FONTS ? saved.font : null
  return {
    name: name ?? DEFAULT_NAME,
    accent: accent && !accentProblem(accent) ? accent : DEFAULT_ACCENT,
    font: font ?? DEFAULT_FONT,
    poweredBy: typeof saved?.poweredBy === 'boolean' ? saved.poweredBy : true,
  }
}

/** Whether to show "Powered by Flytower": only when it says something the name doesn't. */
export function showPoweredBy(b: Pick<BrandingSettings, 'name' | 'poweredBy'>): boolean {
  return b.poweredBy && b.name.trim().toLowerCase() !== DEFAULT_NAME.toLowerCase()
}

/**
 * The stylesheet that applies a brand on top of Flytower's: primary's scale and the shade
 * each mode uses, and the display font. Empty for Flytower's own colours and font, so the
 * hand-tuned tungsten scale in main.css stays in charge.
 */
export function themeCss(b: BrandingSettings): string {
  const parts: string[] = []
  if (b.accent !== DEFAULT_ACCENT) {
    const scale = buildScale(b.accent)
    const picks = pickShades(b.accent)
    if (picks.light && picks.dark) {
      // :root:root and :root:root.dark outrank main.css's :root and .dark.
      const vars = SHADES.map((s) => `  --ui-color-primary-${s}: ${scale[s]};`).join('\n')
      parts.push(
        `:root:root {\n${vars}\n  --ui-primary: ${picks.light.hex};\n}`,
        `:root:root.dark {\n  --ui-primary: ${picks.dark.hex};\n}`,
      )
    }
  }
  if (b.font !== DEFAULT_FONT) {
    const f = FONTS[b.font]
    parts.push(
      `:root:root {\n  --font-display: ${f.family};\n  --ft-display-weight: ${f.weight};\n` +
        `  --ft-display-case: ${f.uppercase ? 'uppercase' : 'none'};\n` +
        `  --ft-display-tracking: ${f.tracking};\n}`,
    )
  }
  return parts.length ? `/* Branding, set on System > Branding */\n${parts.join('\n')}\n` : ''
}

/** The colour for in-game messages: the accent as Minecraft's text component wants it. */
export function gameColour(b: Pick<BrandingSettings, 'accent'>): string {
  return b.accent === DEFAULT_ACCENT ? 'gold' : b.accent.toUpperCase()
}
