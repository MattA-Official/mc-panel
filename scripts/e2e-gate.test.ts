import { describe, expect, it } from 'bun:test'
import { decide, isIgnored, type GateDeps, type Run } from './e2e-gate'

const ignored = ['.github/release-notes/**', 'docs/testing/**', 'README.md']
const done = (conclusion: string): Run => ({ status: 'completed', conclusion, html_url: 'u' })

function deps(runs: Record<string, Run[]>, changes: Record<string, string[]>): GateDeps {
  return {
    history: ['c3', 'c2', 'c1'],
    ignored,
    runs: async (sha) => runs[sha] ?? [],
    changed: async (from) => changes[from] ?? [],
  }
}

describe('the release E2E gate', () => {
  it('matches the ignored paths', () => {
    expect(isIgnored('.github/release-notes/1.4.2.md', ignored)).toBe(true)
    expect(isIgnored('README.md', ignored)).toBe(true)
    expect(isIgnored('apps/panel/README.md', ignored)).toBe(false)
  })

  it('passes on the commit’s own successful run', async () => {
    expect(await decide(deps({ c3: [done('success')] }, {}))).toMatchObject({ ok: true, via: 'c3' })
  })

  it('passes on an earlier run when only release notes changed since', async () => {
    const v = await decide(
      deps({ c2: [done('success')] }, { c2: ['.github/release-notes/1.4.2.md'] }),
    )
    expect(v).toMatchObject({ ok: true, via: 'c2' })
  })

  it('refuses when the product changed since the last run', async () => {
    const v = await decide(deps({ c2: [done('success')] }, { c2: ['apps/panel/server/x.ts'] }))
    expect(v).toMatchObject({ ok: false })
    expect((v as { reason: string }).reason).toContain('apps/panel/server/x.ts')
  })

  it('refuses a failed or unfinished run', async () => {
    expect(await decide(deps({ c3: [done('failure')] }, {}))).toMatchObject({ ok: false })
    expect(
      await decide(deps({ c3: [{ status: 'in_progress', conclusion: null, html_url: 'u' }] }, {})),
    ).toMatchObject({ ok: false })
  })
})
