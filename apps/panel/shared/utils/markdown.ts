/**
 * A small, safe reading of Markdown for release notes: headings, bullet lists, paragraphs,
 * and inline bold, code and links. It returns plain data for a component to render, so no
 * HTML from the notes ever reaches the page.
 */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; content: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'paragraph'; content: Inline[] }

const INLINE =
  /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>]+)/g

/** Only http(s) links survive; anything else stays as text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ type: 'strong', text: m[1] })
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] })
    else if (m[3] !== undefined) out.push({ type: 'link', text: m[3], href: m[4]! })
    else out.push({ type: 'link', text: m[5]!, href: m[5]! })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) })
  return out
}

export function parseNotes(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: Inline[][] | null = null
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) })
    if (list) blocks.push({ type: 'list', items: list })
    para = []
    list = null
  }
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const item = /^[-*+]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, content: parseInline(heading[2]!) })
    } else if (item) {
      if (para.length) flush()
      ;(list ??= []).push(parseInline(item[1]!))
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}
