import { describe, expect, it } from 'bun:test'
import { openDb } from '../server/db'
import { BrandingStore, imageType } from '../server/branding'
import { cleanSvg, SvgError } from '../server/branding/svg'
import { cleanPng, crc32, PngError } from '../server/branding/png'
import {
  DEFAULT_ACCENT,
  DEFAULT_BRANDING,
  accentProblem,
  buildScale,
  contrast,
  gameColour,
  hexToOklch,
  normaliseHex,
  oklchToHex,
  pickShades,
  showPoweredBy,
  themeCss,
  withDefaults,
  type PublicBranding,
} from '../shared/branding'
import { discordPayload } from '../server/notify/discord'
import { tellAll, warningCommands } from '../server/schedules/restart'
import type { Message } from '../server/notify/types'

const svg = (s: string) => cleanSvg(new TextEncoder().encode(s))

describe('colours', () => {
  it('reads hex in its usual spellings', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc')
    expect(normaliseHex('2f6fd0')).toBe('#2f6fd0')
    expect(normaliseHex(' #2F6FD0 ')).toBe('#2f6fd0')
    expect(normaliseHex('red')).toBeNull()
    expect(normaliseHex('#12345')).toBeNull()
  })

  it('round-trips through OKLCH', () => {
    for (const hex of ['#f2a93b', '#2f6fd0', '#10151f', '#ffffff', '#000000', '#7a1fa2']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
    }
  })

  it('works out the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // Tungsten 700 on white, as the design system says.
    expect(contrast('#985511', '#ffffff')).toBeCloseTo(5.77, 1)
  })

  it('keeps the accent on its own step and orders the scale light to dark', () => {
    const scale = buildScale('#2f6fd0')
    expect(Object.values(scale)).toContain('#2f6fd0')
    const lightness = Object.values(scale).map((h) => hexToOklch(h).l)
    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i]!).toBeLessThan(lightness[i - 1]!)
    }
  })

  it("picks the same steps as Flytower's hand-made amber", () => {
    const picks = pickShades(DEFAULT_ACCENT)
    expect(picks.light?.shade).toBe(700)
    expect(picks.dark?.shade).toBe(400)
  })

  it('only picks shades that pass AA against every surface in their mode', () => {
    for (const hex of ['#2f6fd0', '#c8102e', '#00ff00', '#ffff00', '#111111', '#e5e5e5']) {
      const { light, dark } = pickShades(hex)
      expect(light!.ratio).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light!.hex, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light!.hex, '#f5f7fa')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dark!.hex, '#10151f')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dark!.hex, '#1b2231')).toBeGreaterThanOrEqual(4.5)
      expect(accentProblem(hex)).toBeNull()
    }
  })

  it('uses a dark brand colour as it is in light mode and a lighter one in dark mode', () => {
    const { light, dark } = pickShades('#7a1fa2')
    expect(light!.hex).toBe('#7a1fa2')
    expect(dark!.hex).not.toBe('#7a1fa2')
  })

  it('refuses something that is not a colour', () => {
    expect(accentProblem('purple')).toMatch(/#2f6fd0/)
  })
})

describe('settings', () => {
  it('fills in defaults and drops what it does not know', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_BRANDING)
    expect(
      withDefaults({ name: '  NNT ', accent: 'nope', font: 'comic' as never, poweredBy: false }),
    ).toEqual({ name: 'NNT', accent: DEFAULT_ACCENT, font: 'big-shoulders', poweredBy: false })
  })

  it('shows "Powered by" only when the name is not Flytower', () => {
    expect(showPoweredBy({ name: 'Flytower', poweredBy: true })).toBe(false)
    expect(showPoweredBy({ name: 'NNT Minecraft', poweredBy: true })).toBe(true)
    expect(showPoweredBy({ name: 'NNT Minecraft', poweredBy: false })).toBe(false)
  })

  it('writes no stylesheet for Flytower’s own look', () => {
    expect(themeCss(DEFAULT_BRANDING)).toBe('')
  })

  it('writes the scale, both modes and the font when they change', () => {
    const css = themeCss({ ...DEFAULT_BRANDING, accent: '#2f6fd0', font: 'fraunces' })
    const picks = pickShades('#2f6fd0')
    expect(css).toContain(`--ui-color-primary-500:`)
    expect(css).toContain(`:root:root {`)
    expect(css).toContain(`--ui-primary: ${picks.light!.hex};`)
    expect(css).toContain(`:root:root.dark {\n  --ui-primary: ${picks.dark!.hex};`)
    expect(css).toContain("--font-display: 'Fraunces Variable'")
    expect(css).toContain('--ft-display-case: none;')
    expect(css).not.toMatch(/[<>{]\s*<|url\(/)
  })

  it('uses gold in-game until the accent changes', () => {
    expect(gameColour(DEFAULT_BRANDING)).toBe('gold')
    expect(gameColour({ accent: '#2f6fd0' })).toBe('#2F6FD0')
  })
})

describe('store', () => {
  const store = () => {
    const seen: PublicBranding[] = []
    const s = new BrandingStore({ db: openDb(':memory:'), onChange: (b) => seen.push(b) })
    return { s, seen }
  }

  it('starts as Flytower', () => {
    const { s } = store()
    const b = s.public()
    expect(b.isDefault).toBe(true)
    expect(b.name).toBe('Flytower')
    expect(b.logo).toBe('/flytower-mark.svg')
    expect(b.favicon).toBe('/favicon.svg')
    expect(s.css()).toBe('')
  })

  it('saves, tells listeners and resets', () => {
    const { s, seen } = store()
    s.save({ name: ' NNT ', accent: '2F6FD0', font: 'space-grotesk', poweredBy: true })
    expect(s.settings()).toEqual({
      name: 'NNT',
      accent: '#2f6fd0',
      font: 'space-grotesk',
      poweredBy: true,
    })
    expect(seen.at(-1)!.isDefault).toBe(false)
    expect(s.css()).toContain('Space Grotesk')
    const tag = s.cssTag()
    s.reset()
    expect(s.public().isDefault).toBe(true)
    expect(s.cssTag()).not.toBe(tag)
    expect(seen).toHaveLength(2)
  })

  it('refuses bad input with a reason', () => {
    const { s } = store()
    const ok = { name: 'NNT', accent: '#2f6fd0', font: 'fraunces', poweredBy: true } as const
    expect(() => s.save({ ...ok, name: '   ' })).toThrow(/name/)
    expect(() => s.save({ ...ok, name: 'x'.repeat(41) })).toThrow(/40/)
    expect(() => s.save({ ...ok, name: 'a\u0000b' })).toThrow(/characters/)
    expect(() => s.save({ ...ok, accent: 'blue' })).toThrow(/#2f6fd0/)
    expect(() => s.save({ ...ok, font: 'comic' as never })).toThrow()
  })

  it('stores a cleaned logo and uses it as the favicon until one is uploaded', () => {
    const { s } = store()
    s.setImage(
      'logo',
      'image/svg+xml',
      new TextEncoder().encode('<svg viewBox="0 0 1 1" onload="x()"><rect/></svg>'),
    )
    const logo = s.image('logo')!
    expect(Buffer.from(logo.data, 'base64').toString()).not.toContain('onload')
    const b = s.public()
    expect(b.logo).toBe(`/branding/logo?v=${logo.hash}`)
    expect(b.favicon).toBe(`/branding/favicon?v=${logo.hash}`)
    expect(b.customFavicon).toBe(false)
    s.setImage('favicon', 'image/png', png(16, 16))
    expect(s.public().customFavicon).toBe(true)
    s.removeImage('logo')
    expect(s.public().logo).toBe('/flytower-mark.svg')
  })

  it('refuses files that are not what they say', () => {
    expect(() => imageType('image/png', new TextEncoder().encode('<svg/>'))).toThrow(/PNG/)
    expect(() => imageType('image/svg+xml', png(1, 1))).toThrow(/SVG/)
    expect(() => imageType('image/gif', png(1, 1))).toThrow(/SVG or PNG/)
    const { s } = store()
    expect(() => s.setImage('logo', 'image/png', new Uint8Array())).toThrow(/empty/)
    expect(() => s.setImage('logo', 'image/svg+xml', new Uint8Array(1024 * 1024 + 1))).toThrow(
      /1 MB/,
    )
  })
})

describe('SVG cleaning', () => {
  it('keeps an ordinary logo', () => {
    const out = svg(
      '<?xml version="1.0"?>\n<!-- Inkscape -->\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="x" viewBox="0 0 24 24" inkscape:version="1">' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<sodipodi:namedview id="n"/><metadata><rdf:RDF/></metadata>' +
        '<g fill="url(#g)" transform="translate(1 1)"><path d="M0 0h10v10z"/><circle cx="5" cy="5" r="2" style="fill: red"/></g>' +
        '<text x="1" y="2" font-family="sans-serif">A &amp; B</text></svg>',
    )
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<g fill="url(#g)" transform="translate(1 1)"><path d="M0 0h10v10z"/><circle cx="5" cy="5" r="2" style="fill: red"/></g>' +
        '<text x="1" y="2" font-family="sans-serif">A &amp; B</text></svg>\n',
    )
  })

  it.each([
    ['<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', 'script'],
    ['<svg viewBox="0 0 1 1"><SCRIPT>alert(1)</SCRIPT></svg>', 'alert'],
    ['<svg viewBox="0 0 1 1" onload="alert(1)"/>', 'onload'],
    ['<svg viewBox="0 0 1 1"><rect ONCLICK="x()"/></svg>', 'x()'],
    [
      '<svg viewBox="0 0 1 1"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>',
      'onerror',
    ],
    ['<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png"/></svg>', 'evil'],
    ['<svg viewBox="0 0 1 1"><use href="https://evil.example/s.svg#a"/></svg>', 'evil'],
    ['<svg viewBox="0 0 1 1"><use xlink:href="data:image/svg+xml,..."/></svg>', 'data:'],
    ['<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect/></a></svg>', 'javascript'],
    ['<svg viewBox="0 0 1 1"><rect fill="url(https://evil.example/)"/></svg>', 'evil'],
    ['<svg viewBox="0 0 1 1"><rect style="fill:url(//evil.example/)"/></svg>', 'evil'],
    ['<svg viewBox="0 0 1 1"><rect style="background:u\\72l(x)"/></svg>', '\\72'],
    ['<svg viewBox="0 0 1 1"><animate attributeName="href" to="javascript:x"/></svg>', 'animate'],
    ['<svg viewBox="0 0 1 1"><set attributeName="onload" to="x()"/></svg>', 'set'],
    ['<svg viewBox="0 0 1 1"><iframe src="x"/></svg>', 'iframe'],
    ['<svg viewBox="0 0 1 1"><rect xml:base="https://evil.example/"/></svg>', 'evil'],
  ])('takes out %s', (input, bad) => {
    const out = svg(input)
    expect(out.toLowerCase()).not.toContain(bad.toLowerCase())
    expect(out).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"')
  })

  it('refuses styles that load or run something', () => {
    expect(() =>
      svg('<svg viewBox="0 0 1 1"><style>@import url(https://evil.example/x.css);</style></svg>'),
    ).toThrow(SvgError)
    expect(() =>
      svg('<svg viewBox="0 0 1 1"><style>rect{fill:url(https://e.example/)}</style></svg>'),
    ).toThrow(SvgError)
    expect(
      svg('<svg viewBox="0 0 1 1"><style><![CDATA[rect{fill:url(#g)}]]></style></svg>'),
    ).toContain('<style>rect{fill:url(#g)}</style>')
  })

  it('refuses doctypes and entities, which is how XML bombs and file reads work', () => {
    expect(() =>
      svg(
        '<!DOCTYPE svg [<!ENTITY a "aaaaaaaa"><!ENTITY b "&a;&a;&a;">]><svg viewBox="0 0 1 1"><text>&b;</text></svg>',
      ),
    ).toThrow(/DOCTYPE/)
    expect(() => svg('<svg viewBox="0 0 1 1"><text>&nbsp;</text></svg>')).toThrow(/entity/)
  })

  it('escapes what it writes back out', () => {
    const out = svg(
      '<svg viewBox="0 0 1 1"><title>&lt;b&gt; "x"</title><rect id="&quot;&gt;"/></svg>',
    )
    expect(out).toContain('<title>&lt;b&gt; "x"</title>')
    expect(out).toContain('<rect id="&quot;&gt;"/>')
  })

  it('needs a real, scalable SVG', () => {
    expect(() => svg('<html><svg/></html>')).toThrow(/look like an SVG/)
    expect(() => svg('hello')).toThrow(/look like an SVG/)
    expect(() => svg('<svg><rect/></svg>')).toThrow(/viewBox/)
    expect(() => svg('<svg viewBox="0 0 1 1"><g></svg>')).toThrow(/well formed/)
    expect(() => svg('<svg viewBox="0 0 1 1"><rect fill=red /></svg>')).toThrow(/well formed/)
    expect(() => svg('<svg viewBox="0 0 1 1"></svg><svg viewBox="0 0 1 1"></svg>')).toThrow(/root/)
    expect(() => cleanSvg(new Uint8Array([0xff, 0xfe, 0x3c]))).toThrow(/UTF-8/)
    expect(svg('<svg width="10" height="10"/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>\n',
    )
  })
})

/** A minimal valid PNG (one grey pixel row per line), with extra chunks if asked. */
function png(width: number, height: number, extra: [string, Uint8Array][] = []): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 0, 0, 0, 0], 8) // 8-bit greyscale
  const raw = new Uint8Array(height * (width + 1))
  const idat = Bun.deflateSync(raw, { level: 9 })
  // zlib wrapper around the raw deflate stream: header, data, Adler-32 of nothing important.
  const z = new Uint8Array([0x78, 0x9c, ...idat, 0, 0, 0, 1])
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra.map(([t, d]) => chunk(t, d)),
    chunk('IDAT', z),
    chunk('IEND', new Uint8Array()),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

describe('PNG cleaning', () => {
  it('keeps the picture and drops the metadata', () => {
    const text = new TextEncoder().encode('Author\0Someone private')
    const input = png(4, 3, [
      ['tEXt', text],
      ['eXIf', new Uint8Array([1, 2, 3])],
      ['gAMA', new Uint8Array([0, 0, 0xb1, 0x8f])],
    ])
    const { bytes, info } = cleanPng(input)
    expect(info).toEqual({ width: 4, height: 3 })
    const s = new TextDecoder('latin1').decode(bytes)
    expect(s).not.toContain('tEXt')
    expect(s).not.toContain('Someone private')
    expect(s).not.toContain('eXIf')
    expect(s).toContain('gAMA')
    expect(s).toContain('IDAT')
    expect(bytes.length).toBeLessThan(input.length)
    // Cleaning a clean file changes nothing.
    expect(cleanPng(bytes).bytes).toEqual(bytes)
  })

  it('refuses what is not a whole, sensible PNG', () => {
    expect(() => cleanPng(new TextEncoder().encode('GIF89a'))).toThrow(PngError)
    const good = png(2, 2)
    expect(() => cleanPng(good.subarray(0, good.length - 5))).toThrow(/cut short/)
    const bad = good.slice()
    bad[30] = bad[30]! ^ 0xff
    expect(() => cleanPng(bad)).toThrow(/damaged/)
    expect(() => cleanPng(png(2000, 10))).toThrow(/1024/)
  })
})

describe('where the brand shows up', () => {
  const msg = (from?: Message['from']): Message => ({
    kind: 'test',
    title: 'Hi',
    severity: 'info',
    id: '1',
    at: new Date(0),
    serverDisplayName: 'Survival',
    url: null,
    ...(from && { from }),
  })

  it('posts to Discord under the install’s name and logo', () => {
    const p = discordPayload(msg({ name: 'NNT', avatarUrl: 'https://p.example/branding/logo' }))
    expect(p.username).toBe('NNT')
    expect(p.avatar_url).toBe('https://p.example/branding/logo')
    expect((p.embeds[0] as { footer: { text: string } }).footer.text).toBe('NNT · Survival')
  })

  it('stays Flytower without a brand, and when Discord would refuse the name', () => {
    expect(discordPayload(msg()).username).toBe('Flytower')
    expect(discordPayload(msg()).avatar_url).toBeUndefined()
    expect(discordPayload(msg({ name: 'Our Discord', avatarUrl: null })).username).toBe('Flytower')
  })

  it('colours in-game messages', () => {
    expect(tellAll('Hello')).toBe('tellraw @a {"text":"Hello","color":"gold"}')
    expect(tellAll('Hello', '#2F6FD0')).toBe('tellraw @a {"text":"Hello","color":"#2F6FD0"}')
    expect(warningCommands(5, '#2F6FD0').every((c) => c.includes('#2F6FD0'))).toBe(true)
  })
})

describe('activity', () => {
  it('describes branding changes and files them under Flytower', async () => {
    const { auditKind, describeAudit } = await import('../shared/utils/audit')
    expect(describeAudit('branding.update', null, { name: 'NNT', accent: '#2f6fd0' })).toBe(
      'Changed the branding (NNT, #2f6fd0)',
    )
    expect(describeAudit('branding.reset', null, null)).toBe("Reset the branding to Flytower's own")
    expect(auditKind('branding.logo')).toBe('system')
  })
})
