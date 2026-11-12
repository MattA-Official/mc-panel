import { docAnchors } from './anchors'

// A Nuxt layer for the repo's docs/ folder. The panel (at /help) and the website (at /docs)
// both extend it, so the same Markdown renders the same way in each. Each app adds
// @nuxt/content itself and sets `docs.base` in its app.config.

/** Icons the :ui chips can show. They're named in anchors.ts, which the icon scan skips. */
const chipIcons = [
  ...new Set(
    [
      ...Object.values(docAnchors).flatMap((a) => ('icon' in a ? [a.icon] : [])),
      'i-lucide-mouse-pointer-click',
      'i-lucide-text-cursor-input',
      'i-lucide-panel-top',
      'i-lucide-square',
      'i-lucide-locate-fixed',
      'i-lucide-zap',
    ].map((name) => name.replace(/^i-([a-z0-9]+)-/, '$1:')),
  ),
]

export default defineNuxtConfig({
  icon: { clientBundle: { icons: chipIcons } },
})
