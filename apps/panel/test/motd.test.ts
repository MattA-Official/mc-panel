import { describe, expect, it } from 'bun:test'
import {
  glyphAdvance,
  layoutMotd,
  MOTD_COLOURS,
  MOTD_LINE_WIDTH,
  motdPlainText,
  obfuscate,
  parseMotd,
  PLAIN,
  serialiseMotd,
  type MotdLine,
} from '../shared/utils/motd'

const style = (s: Partial<typeof PLAIN>) => ({ ...PLAIN, ...s })

describe('parseMotd', () => {
  it('reads plain text as one plain run', () => {
    expect(parseMotd('A Minecraft Server')).toEqual([
      [{ text: 'A Minecraft Server', style: style({}) }],
    ])
  })

  it('reads colours and formats, case-insensitively', () => {
    expect(parseMotd('§6§LGold bold§r plain §A§oGreen italic')).toEqual([
      [
        { text: 'Gold bold', style: style({ colour: '6', bold: true }) },
        { text: ' plain ', style: style({}) },
        { text: 'Green italic', style: style({ colour: 'a', italic: true }) },
      ],
    ])
  })

  it('clears formats when the colour changes, as the game does', () => {
    expect(parseMotd('§l§nBoth§cRed')).toEqual([
      [
        { text: 'Both', style: style({ bold: true, underlined: true }) },
        { text: 'Red', style: style({ colour: 'c' }) },
      ],
    ])
  })

  it('drops unknown codes and a trailing §', () => {
    expect(parseMotd('§zOne§x§2Two§')).toEqual([
      [
        { text: 'One', style: style({}) },
        { text: 'Two', style: style({ colour: '2' }) },
      ],
    ])
  })

  it('splits lines and carries the style over the break', () => {
    expect(parseMotd('§bTop\nBottom§r end')).toEqual([
      [{ text: 'Top', style: style({ colour: 'b' }) }],
      [
        { text: 'Bottom', style: style({ colour: 'b' }) },
        { text: ' end', style: style({}) },
      ],
    ])
    expect(parseMotd('One\r\nTwo')).toHaveLength(2)
  })

  it('keeps every formatting code', () => {
    const [[run]] = parseMotd('§k§l§m§n§oX') as [[MotdLine[number]]]
    expect(run.style).toEqual(
      style({ obfuscated: true, bold: true, strikethrough: true, underlined: true, italic: true }),
    )
  })

  it('gives plain text with codes taken out', () => {
    expect(motdPlainText('§6§lNew §rTheatre\n§7Survival')).toBe('New Theatre\nSurvival')
  })
})

describe('serialiseMotd', () => {
  it('writes the fewest codes it can', () => {
    const lines: MotdLine[] = [
      [
        { text: 'Gold ', style: style({ colour: '6' }) },
        { text: 'bold', style: style({ colour: '6', bold: true }) },
        { text: ' plain', style: style({}) },
      ],
    ]
    expect(serialiseMotd(lines)).toBe('§6Gold §lbold§r plain')
  })

  it('switches colour without a reset, and resets to drop a format', () => {
    expect(
      serialiseMotd([
        [
          { text: 'A', style: style({ colour: 'c', bold: true }) },
          { text: 'B', style: style({ colour: 'c' }) },
          { text: 'C', style: style({ colour: '9' }) },
          { text: 'D', style: style({ colour: '9', italic: true, underlined: true }) },
        ],
      ]),
    ).toBe('§c§lA§cB§9C§n§oD')
  })

  it('carries style over the line break, and resets when the next line is plain', () => {
    expect(
      serialiseMotd([
        [{ text: 'Top', style: style({ colour: 'e' }) }],
        [
          { text: 'Still yellow', style: style({ colour: 'e' }) },
          { text: '!', style: style({}) },
        ],
      ]),
    ).toBe('§eTop\nStill yellow§r!')
    expect(
      serialiseMotd([
        [{ text: 'Top', style: style({ bold: true }) }],
        [{ text: 'x', style: PLAIN }],
      ]),
    ).toBe('§lTop\n§rx')
  })

  it('leaves off an empty second line and any literal §', () => {
    expect(serialiseMotd([[{ text: 'One§', style: PLAIN }], []])).toBe('One')
    expect(serialiseMotd([[]])).toBe('')
  })

  it('round-trips what it writes', () => {
    for (const text of [
      'A Minecraft Server',
      '§6§lNew Theatre §r§7Survival\n§bOpen to members',
      '§k§l§m§n§oAll§r none\n§0black §fwhite',
      'Line one\nLine two',
      '§aGreen\n§lstill green, bold',
    ]) {
      const once = serialiseMotd(parseMotd(text))
      expect(parseMotd(once)).toEqual(parseMotd(text))
      expect(serialiseMotd(parseMotd(once))).toBe(once)
    }
  })

  it('tidies codes that change nothing', () => {
    expect(serialiseMotd(parseMotd('§r§c§cRed§c§lBold'))).toBe('§cRed§lBold')
  })
})

describe('layoutMotd', () => {
  it('uses the default font widths, and bold adds a pixel', () => {
    expect(glyphAdvance('a')).toBe(6)
    expect(glyphAdvance('i')).toBe(2)
    expect(glyphAdvance(' ')).toBe(4)
    expect(glyphAdvance('W', true)).toBe(7)
    expect(layoutMotd('Hi!').widths).toEqual([6 + 2 + 2])
    expect(layoutMotd('§lHi!').widths).toEqual([7 + 3 + 3])
  })

  it('shows a short two-line MOTD as it is', () => {
    const l = layoutMotd('§6Top\nBottom')
    expect(l.visible).toHaveLength(2)
    expect(l.wrapped).toEqual([])
    expect(l.hidden).toBe('')
  })

  it('wraps a wide first line at a space and cuts the second line off', () => {
    const word = 'abcdeabcde' // 60 pixels, plus 4 for a space
    const first = Array(5).fill(word).join(' ') // 316 pixels
    const l = layoutMotd(`${first}\nSecond line`)
    expect(l.widths[0]).toBe(316)
    expect(l.wrapped).toEqual([0])
    expect(l.visible.map((line) => line.map((r) => r.text).join(''))).toEqual([
      Array(4).fill(word).join(' '),
      word,
    ])
    expect(l.hidden).toBe('Second line')
  })

  it('breaks a word too long for a line mid-word', () => {
    const l = layoutMotd('a'.repeat(50))
    expect(l.visible[0]![0]!.text).toBe('a'.repeat(Math.floor(MOTD_LINE_WIDTH / 6)))
    expect(l.visible[1]![0]!.text.length).toBe(50 - Math.floor(MOTD_LINE_WIDTH / 6))
  })

  it('lets a line fill the width exactly', () => {
    expect(layoutMotd('a'.repeat(44) + '@').widths).toEqual([MOTD_LINE_WIDTH])
    expect(layoutMotd('a'.repeat(44) + '@').wrapped).toEqual([])
    expect(layoutMotd('a'.repeat(44) + '@i').wrapped).toEqual([0])
  })
})

describe('colours and obfuscation', () => {
  it('has the 16 vanilla colours', () => {
    expect(MOTD_COLOURS.map((c) => c.code).join('')).toBe('0123456789abcdef')
    expect(MOTD_COLOURS.find((c) => c.code === '6')!.hex).toBe('#FFAA00')
  })

  it('swaps characters for others of the same width', () => {
    let n = 0
    const out = obfuscate('Hi there', () => (n++ % 7) / 7)
    expect(out).toHaveLength(8)
    expect(out[2]).toBe(' ')
    expect([...out].map((c) => glyphAdvance(c))).toEqual(
      [...'Hi there'].map((c) => glyphAdvance(c)),
    )
  })
})
