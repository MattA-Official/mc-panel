import { describe, expect, it } from 'bun:test'
import { compareVersions, listReleases } from '../server/updates'

describe('updates', () => {
  it('orders versions', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('0.4.0', 'v0.4.0')).toBe(0)
  })

  it('lists only signed releases, newest first', async () => {
    const rel = (tag: string, signed: boolean) => ({
      tag_name: tag,
      body: `notes ${tag}`,
      html_url: `https://x/${tag}`,
      published_at: '2026-11-09T00:00:00Z',
      draft: false,
      assets: signed
        ? [{ name: 'SHA256SUMS' }, { name: 'SHA256SUMS.sig' }]
        : [{ name: 'SHA256SUMS' }],
    })
    const list = await listReleases(async () =>
      Response.json([rel('v0.4.0', false), rel('v0.6.0', true), rel('v0.5.0', true)]),
    )
    expect(list.map((r) => r.version)).toEqual(['0.6.0', '0.5.0'])
  })
})
