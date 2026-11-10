import { describe, expect, it } from 'bun:test'
import { parseInline, parseNotes } from '../shared/utils/markdown'

describe('markdown', () => {
  it('reads release notes as headings, lists and paragraphs', () => {
    const blocks = parseNotes(
      '### Fixes\n\n- **panel:** works ([abc1234](https://github.com/x/y/commit/abc))\n- two\n\n**Full diff:** https://github.com/x/y/compare/a...b',
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'paragraph'])
    expect(blocks[1]).toEqual({
      type: 'list',
      items: [
        [
          { type: 'strong', text: 'panel:' },
          { type: 'text', text: ' works (' },
          { type: 'link', text: 'abc1234', href: 'https://github.com/x/y/commit/abc' },
          { type: 'text', text: ')' },
        ],
        [{ type: 'text', text: 'two' }],
      ],
    })
    expect(blocks[2]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'strong', text: 'Full diff:' },
        { type: 'text', text: ' ' },
        {
          type: 'link',
          text: 'https://github.com/x/y/compare/a...b',
          href: 'https://github.com/x/y/compare/a...b',
        },
      ],
    })
  })

  it('never makes links out of anything but http(s)', () => {
    expect(parseInline('[x](javascript:alert(1)) <b>hi</b>')).toEqual([
      { type: 'text', text: '[x](javascript:alert(1)) <b>hi</b>' },
    ])
  })
})
