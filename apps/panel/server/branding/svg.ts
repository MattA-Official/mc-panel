/**
 * Cleaning uploaded SVG logos. The file is split into tags and text, and a new SVG is written
 * from only the elements and attributes on the lists below: nothing is filtered out of the
 * original, so anything this doesn't recognise can't survive. That drops scripts, event
 * handlers, foreignObject, embedded images, external references and doctypes (entity tricks).
 *
 * The result is still only ever shown through <img> and served with its own locked-down
 * content security policy; this is the second wall, not the only one.
 */

export class SvgError extends Error {
  override name = 'SvgError'
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Shapes, grouping, gradients, clipping, simple filters and text. No image, use of files, or animation. */
const ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'style',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomposite',
  'fedropshadow',
  'feflood',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'feoffset',
])

/** The proper case of the camelCase element names, keyed by their lower case. */
const ELEMENT_CASE: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomposite: 'feComposite',
  fedropshadow: 'feDropShadow',
  feflood: 'feFlood',
  fegaussianblur: 'feGaussianBlur',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  feoffset: 'feOffset',
}

const ATTRIBUTES = new Set(
  [
    // Core and geometry
    'id',
    'class',
    'style',
    'viewBox',
    'preserveAspectRatio',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'fr',
    'd',
    'points',
    'pathLength',
    'transform',
    'href',
    'version',
    // Presentation
    'fill',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'clip-path',
    'mask',
    'filter',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'opacity',
    'color',
    'display',
    'visibility',
    'overflow',
    'paint-order',
    'vector-effect',
    'shape-rendering',
    'color-interpolation-filters',
    'mix-blend-mode',
    'isolation',
    // Text
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'dominant-baseline',
    'dx',
    'dy',
    'rotate',
    'textLength',
    'lengthAdjust',
    // Gradients, patterns, clips, masks, markers
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'clipPathUnits',
    'maskUnits',
    'maskContentUnits',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'refX',
    'refY',
    'orient',
    'marker-start',
    'marker-mid',
    'marker-end',
    // Filters
    'filterUnits',
    'primitiveUnits',
    'in',
    'in2',
    'result',
    'mode',
    'type',
    'values',
    'operator',
    'k1',
    'k2',
    'k3',
    'k4',
    'stdDeviation',
    'flood-color',
    'flood-opacity',
  ].map((a) => a.toLowerCase()),
)

const ATTRIBUTE_CASE = new Map(
  [
    'viewBox',
    'preserveAspectRatio',
    'pathLength',
    'textLength',
    'lengthAdjust',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'clipPathUnits',
    'maskUnits',
    'maskContentUnits',
    'markerWidth',
    'markerHeight',
    'markerUnits',
    'refX',
    'refY',
    'filterUnits',
    'primitiveUnits',
    'stdDeviation',
  ].map((a) => [a.toLowerCase(), a]),
)

/** Attributes whose value may only point inside the file. */
const URL_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
])

/** `url(...)` that points anywhere but `#an-id` in this file. */
const EXTERNAL_URL = /url\s*\(\s*(?!['"]?#[\w.:-]+['"]?\s*\))/i

/** CSS that could fetch, run or hide something. Unicode escapes go too, so none of it can be spelled around. */
function unsafeCss(css: string): boolean {
  return (
    EXTERNAL_URL.test(css) ||
    /@import|@font-face|@namespace|expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding|image-set\s*\(|[\\<]/i.test(
      css,
    )
  )
}

interface Tag {
  kind: 'open' | 'close'
  name: string
  attrs: [string, string][]
  selfClosing: boolean
}
type Token = Tag | { kind: 'text'; text: string }

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
        throw new SvgError('Bad character reference.')
      return String.fromCodePoint(code)
    }
    const named = NAMED[ref.toLowerCase()]
    if (named === undefined || !whole.endsWith(';')) {
      throw new SvgError(`The SVG uses an entity (&${ref};) that isn't allowed.`)
    }
    return named
  })
}

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;')

function tokenise(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      out.push({ kind: 'text', text: decodeEntities(src.slice(i)) })
      break
    }
    if (lt > i) out.push({ kind: 'text', text: decodeEntities(src.slice(i, lt)) })
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      if (end === -1) throw new SvgError('The SVG has a comment that never ends.')
      i = end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      if (end === -1) throw new SvgError('The SVG has a CDATA section that never ends.')
      out.push({ kind: 'text', text: src.slice(lt + 9, end) })
      i = end + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2)
      if (end === -1) throw new SvgError('The SVG has a processing instruction that never ends.')
      i = end + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE and anything like it: entity declarations are how XML bombs and file reads work.
      throw new SvgError("SVGs with a DOCTYPE aren't allowed. Export it again as plain SVG.")
    }
    const close = src[lt + 1] === '/'
    const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(src.slice(lt + (close ? 2 : 1)))
    if (!nameMatch) throw new SvgError("The SVG isn't well formed.")
    const name = nameMatch[0]
    let j = lt + (close ? 2 : 1) + name.length
    const attrs: [string, string][] = []
    let selfClosing = false
    for (;;) {
      while (/\s/.test(src[j] ?? '')) j++
      if (j >= src.length) throw new SvgError("The SVG isn't well formed.")
      if (src[j] === '>') {
        j++
        break
      }
      if (src.startsWith('/>', j)) {
        selfClosing = true
        j += 2
        break
      }
      const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(src.slice(j))
      if (!attr || close) throw new SvgError("The SVG isn't well formed.")
      attrs.push([attr[1]!, decodeEntities(attr[2] ?? attr[3] ?? '')])
      j += attr[0].length
    }
    out.push({ kind: close ? 'close' : 'open', name, attrs, selfClosing })
    i = j
  }
  return out
}

/** One attribute, cleaned, or null to drop it. */
function cleanAttribute(element: string, rawName: string, value: string): [string, string] | null {
  let name = rawName
  if (name === 'xlink:href') name = 'href'
  if (name.includes(':') || /^on/i.test(name)) return null
  const lower = name.toLowerCase()
  if (!ATTRIBUTES.has(lower)) return null
  const proper = ATTRIBUTE_CASE.get(lower) ?? lower
  const v = value.trim()
  if (/javascript:|data:|vbscript:/i.test(v.replace(/\s+/g, ''))) return null
  if (proper === 'href') {
    // Only <use> may point anywhere, and only at an element in this file.
    return element === 'use' && /^#[\w.:-]+$/.test(v) ? [proper, v] : null
  }
  if (proper === 'style') return unsafeCss(v) ? null : [proper, v]
  if (URL_ATTRIBUTES.has(proper) && EXTERNAL_URL.test(v)) return null
  return [proper, v]
}

/**
 * Rebuilds an SVG from its allowed parts. Throws SvgError with a reason a person can act on
 * when it isn't an SVG, or uses something that can't be cleaned.
 */
export function cleanSvg(input: Uint8Array): string {
  let src: string
  try {
    src = new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    throw new SvgError("That SVG isn't UTF-8 text.")
  }
  src = src.replace(/^\uFEFF/, '')
  const tokens = tokenise(src)

  const out: string[] = []
  /** Open allowed elements, to check nesting and close them properly. */
  const stack: string[] = []
  /** Depth inside an element that's being dropped with everything in it. */
  let dropping = 0
  let sawRoot = false
  let rootSized = false

  for (const t of tokens) {
    if (t.kind === 'text') {
      if (dropping || !stack.length) {
        if (!stack.length && t.text.trim()) throw new SvgError("That doesn't look like an SVG.")
        continue
      }
      const parent = stack[stack.length - 1]
      if (parent === 'style') {
        if (unsafeCss(t.text)) throw new SvgError('The SVG has styles that load or run something.')
        out.push(escapeText(t.text))
      } else if (
        parent === 'text' ||
        parent === 'tspan' ||
        parent === 'title' ||
        parent === 'desc'
      ) {
        out.push(escapeText(t.text))
      } else if (t.text.trim() === '') {
        out.push(t.text.includes('\n') ? '\n' : '')
      }
      continue
    }

    const local = t.name.toLowerCase()
    if (t.kind === 'close') {
      if (dropping) {
        dropping--
        continue
      }
      const open = stack.pop()
      if (open !== local) throw new SvgError("The SVG isn't well formed.")
      out.push(`</${ELEMENT_CASE[local] ?? local}>`)
      continue
    }

    if (dropping) {
      if (!t.selfClosing) dropping++
      continue
    }
    if (!sawRoot) {
      if (local !== 'svg') throw new SvgError("That doesn't look like an SVG.")
      sawRoot = true
    } else if (!stack.length) {
      throw new SvgError('The SVG has more than one root element.')
    }
    if (!ELEMENTS.has(local) || t.name.includes(':')) {
      // Drop it and everything inside it: <script>, <foreignObject>, <image>, editor metadata.
      if (!t.selfClosing) dropping = 1
      continue
    }

    const attrs = t.attrs
      .map(([n, v]) => cleanAttribute(local, n, v))
      .filter((a): a is [string, string] => a !== null)
    if (stack.length === 0) {
      const has = (n: string) => attrs.some(([k]) => k === n)
      rootSized = has('viewBox') || (has('width') && has('height'))
      attrs.unshift(['xmlns', SVG_NS])
    }
    const tagName = ELEMENT_CASE[local] ?? local
    const rendered = attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')
    if (t.selfClosing) {
      out.push(`<${tagName}${rendered}/>`)
    } else {
      out.push(`<${tagName}${rendered}>`)
      stack.push(local)
    }
  }
  if (!sawRoot) throw new SvgError("That doesn't look like an SVG.")
  if (stack.length || dropping) throw new SvgError("The SVG isn't well formed.")
  if (!rootSized) {
    throw new SvgError('The SVG needs a viewBox, or a width and height, so it can be scaled.')
  }
  return out.join('').trim() + '\n'
}
