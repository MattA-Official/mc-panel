/**
 * The install's branding: reading and changing it, and everything built from it (the theme
 * stylesheet, the public summary, the images). Kept in the settings table, so it moves with
 * the database. Reads are cached in memory: the stylesheet is fetched on every page load.
 */
import { z } from 'zod'
import type { DbOrTx } from '../db'
import { deleteSetting, getSetting, setSetting, type StoredImage } from '../settings'
import {
  DEFAULT_BRANDING,
  FONTS,
  MAX_IMAGE_BYTES,
  NAME_MAX,
  accentProblem,
  normaliseHex,
  pickShades,
  themeCss,
  withDefaults,
  type BrandingSettings,
  type FontId,
  type ImageSlot,
  type ImageType,
  type PublicBranding,
} from '../../shared/branding'
import { cleanSvg, SvgError } from './svg'
import { cleanPng, PngError } from './png'

export class BrandingError extends Error {
  override name = 'BrandingError'
}

/** Raw uploads above this are refused before cleaning, which often shrinks editor SVGs. */
export const MAX_UPLOAD_BYTES = 1024 * 1024

export const BrandingInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give it a name.')
    .max(NAME_MAX, `Keep the name to ${NAME_MAX} characters.`)
    // No control characters: the name goes into page titles, Discord and passkey prompts.
    .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'The name has characters that can’t be shown.'),
  accent: z.string().transform((s, ctx) => {
    const hex = normaliseHex(s)
    const problem = hex ? accentProblem(hex) : 'Use a colour like #2f6fd0.'
    if (problem || !hex) {
      ctx.addIssue({ code: 'custom', message: problem ?? 'Use a colour like #2f6fd0.' })
      return z.NEVER
    }
    return hex
  }),
  font: z.enum(Object.keys(FONTS) as [FontId, ...FontId[]]),
  poweredBy: z.boolean(),
})

const KEYS = { logo: 'branding.logo', favicon: 'branding.favicon' } as const

export interface BrandingDeps {
  db: DbOrTx
  /** Told whenever anything changes, with the new public summary. */
  onChange?: (b: PublicBranding) => void
}

export class BrandingStore {
  private cached: {
    settings: BrandingSettings
    images: Partial<Record<ImageSlot, StoredImage>>
  } | null = null

  constructor(private deps: BrandingDeps) {}

  private load() {
    if (!this.cached) {
      const images: Partial<Record<ImageSlot, StoredImage>> = {}
      for (const slot of ['logo', 'favicon'] as const) {
        const img = getSetting(this.deps.db, KEYS[slot])
        if (img) images[slot] = img
      }
      this.cached = { settings: withDefaults(getSetting(this.deps.db, 'branding')), images }
    }
    return this.cached
  }

  private changed() {
    this.cached = null
    this.deps.onChange?.(this.public())
  }

  settings(): BrandingSettings {
    return this.load().settings
  }

  image(slot: ImageSlot): StoredImage | null {
    return this.load().images[slot] ?? null
  }

  /** What the sign-in page, the status page and every open tab need. */
  public(): PublicBranding {
    const { settings, images } = this.load()
    const picks = pickShades(settings.accent)
    const logo = images.logo
    const favicon = images.favicon ?? images.logo
    return {
      ...settings,
      isDefault:
        !logo &&
        !images.favicon &&
        (Object.keys(DEFAULT_BRANDING) as (keyof BrandingSettings)[]).every(
          (k) => settings[k] === DEFAULT_BRANDING[k],
        ),
      logo: logo ? `/branding/logo?v=${logo.hash}` : '/flytower-mark.svg',
      favicon: favicon ? `/branding/favicon?v=${favicon.hash}` : '/favicon.svg',
      customLogo: !!logo,
      customFavicon: !!images.favicon,
      shades: { light: picks.light?.hex ?? '', dark: picks.dark?.hex ?? '' },
    }
  }

  /** The stylesheet every page links. Empty when the colours and font are Flytower's. */
  css(): string {
    return themeCss(this.settings())
  }

  /** A short tag that changes whenever the stylesheet does. */
  cssTag(): string {
    return new Bun.CryptoHasher('sha256').update(this.css()).digest('hex').slice(0, 16)
  }

  save(input: z.input<typeof BrandingInput>): BrandingSettings {
    const parsed = BrandingInput.safeParse(input)
    if (!parsed.success)
      throw new BrandingError(parsed.error.issues[0]?.message ?? 'Check the form.')
    setSetting(this.deps.db, 'branding', parsed.data)
    this.changed()
    return this.settings()
  }

  /** Cleans and stores a logo or favicon. Throws BrandingError with the reason it can't. */
  setImage(slot: ImageSlot, type: string, raw: Uint8Array): StoredImage {
    if (raw.length === 0) throw new BrandingError('The file is empty.')
    if (raw.length > MAX_UPLOAD_BYTES) throw new BrandingError('That file is over 1 MB.')
    const kind = imageType(type, raw)
    let bytes: Uint8Array
    try {
      bytes =
        kind === 'image/svg+xml' ? new TextEncoder().encode(cleanSvg(raw)) : cleanPng(raw).bytes
    } catch (err) {
      if (err instanceof SvgError || err instanceof PngError) throw new BrandingError(err.message)
      throw err
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new BrandingError(
        `Once cleaned it's still over ${MAX_IMAGE_BYTES / 1024} KB. Try a simpler or smaller image.`,
      )
    }
    const stored: StoredImage = {
      type: kind,
      data: Buffer.from(bytes).toString('base64'),
      hash: new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 16),
    }
    setSetting(this.deps.db, KEYS[slot], stored)
    this.changed()
    return stored
  }

  removeImage(slot: ImageSlot) {
    deleteSetting(this.deps.db, KEYS[slot])
    this.changed()
  }

  /** Back to Flytower's own look. */
  reset() {
    deleteSetting(this.deps.db, 'branding')
    deleteSetting(this.deps.db, KEYS.logo)
    deleteSetting(this.deps.db, KEYS.favicon)
    this.changed()
  }
}

/** SVG or PNG, decided by the bytes, and the declared type has to agree. */
export function imageType(declared: string, raw: Uint8Array): ImageType {
  const isPng = raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47
  const type = declared.split(';')[0]!.trim().toLowerCase()
  if (type === 'image/png') {
    if (!isPng) throw new BrandingError("That file says it's a PNG but isn't one.")
    return 'image/png'
  }
  if (type === 'image/svg+xml') {
    if (isPng) throw new BrandingError("That file says it's an SVG but is a PNG.")
    return 'image/svg+xml'
  }
  throw new BrandingError('Use an SVG or PNG file.')
}
