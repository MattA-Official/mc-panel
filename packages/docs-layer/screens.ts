/**
 * Labelled screenshots of the panel for the website's docs (#270).
 *
 * A docs page asks for one with a block like
 *
 *   ::screenshot{name="backups" anchor="world.backups" labels="backups.back-up-now, backups.schedule"}
 *   The Backups section of a server's World tab.
 *   ::
 *
 * `bun run docs:screens` takes each one from a demo panel, light and dark, and writes
 * `docs/screens/<name>-light.webp`, `<name>-dark.webp` and `<name>.json` (where each label
 * sits). The website draws numbered pins from the JSON; the panel shows "Show me" instead.
 *
 * Pure TypeScript with no Nuxt imports, so the script and `bun test` can use it.
 */

export type ScreenshotDevice = 'desktop' | 'phone'

/** One `::screenshot` block, as the script reads it. */
export interface ScreenshotSpec {
  /** File name in docs/screens/, e.g. "backups". */
  name: string
  /** The anchor whose page is shot; a section anchor crops to that section. */
  anchor: string
  /** Anchors to number on the picture, in order. */
  labels: string[]
  device: ScreenshotDevice
  /** The docs file it's in, for error messages. */
  file?: string
}

/** Where a label sits on a picture, in percent of its width and height. */
export interface ScreenshotLabel {
  anchor: string
  x: number
  y: number
  w: number
  h: number
}

/** docs/screens/<name>.json: the picture's size in CSS pixels and its labels. */
export interface ScreenshotData {
  width: number
  height: number
  device: ScreenshotDevice
  labels: ScreenshotLabel[]
}

/** Splits a `labels="a, b"` value into anchor ids. */
export function parseLabels(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Allowed in a screenshot's name: it becomes a file name and part of a URL. */
export const SCREENSHOT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Every `::screenshot{…}` block in a docs page. */
export function screenshotsInMarkdown(markdown: string, file?: string): ScreenshotSpec[] {
  const found: ScreenshotSpec[] = []
  for (const [, attrs] of markdown.matchAll(/^\s*::screenshot\{([^}]*)\}/gm)) {
    const get = (key: string) => attrs!.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1]
    found.push({
      name: get('name') ?? '',
      anchor: get('anchor') ?? '',
      labels: parseLabels(get('labels')),
      device: get('device') === 'phone' ? 'phone' : 'desktop',
      ...(file ? { file } : {}),
    })
  }
  return found
}

/** The image files for a screenshot, relative to docs/screens/ (and the site's /screens/). */
export function screenshotFiles(name: string) {
  return { light: `${name}-light.webp`, dark: `${name}-dark.webp`, data: `${name}.json` }
}
