/** Link-preview tags for a public status page, for sites that don't run scripts. */

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export function previewTags(input: {
  displayName: string
  description: string
  site: string
  /** Only an uploaded logo: link previews don't show Flytower's SVG mark. */
  image: string | null
}): string[] {
  const description =
    input.description.replace(/\s+/g, ' ').trim().slice(0, 200) ||
    `Join ${input.displayName}, a Minecraft server.`
  const tags: [string, string][] = [
    ['og:type', 'website'],
    ['og:site_name', input.site],
    ['og:title', input.displayName],
    ['og:description', description],
    ...(input.image ? ([['og:image', input.image]] as [string, string][]) : []),
  ]
  return [
    ...tags.map(([p, c]) => `<meta property="${p}" content="${escape(c)}">`),
    `<meta name="description" content="${escape(description)}">`,
    `<meta name="twitter:card" content="summary">`,
  ]
}
