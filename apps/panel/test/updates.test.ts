import { describe, expect, it } from 'bun:test'
import { openDb } from '../server/db'
import { getSetting, setSetting } from '../server/settings'
import { compareVersions, defaultChannel, listReleases, onChannel } from '../server/updates'

const rel = (tag: string, signed = true, prerelease = false) => ({
  tag_name: tag,
  body: `notes ${tag}`,
  html_url: `https://x/${tag}`,
  published_at: '2026-11-09T00:00:00Z',
  draft: false,
  prerelease,
  assets: signed ? [{ name: 'SHA256SUMS' }, { name: 'SHA256SUMS.sig' }] : [{ name: 'SHA256SUMS' }],
})

describe('updates', () => {
  it('orders versions', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('0.4.0', 'v0.4.0')).toBe(0)
  })

  it('orders pre-releases part by part', () => {
    expect(compareVersions('1.1.0-beta.10', '1.1.0-beta.9')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0-beta.2', '1.1.0-rc.1')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta', '1.1.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta.3', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta.1', '1.0.1')).toBeGreaterThan(0)
  })

  it('lists only signed releases, newest first', async () => {
    const list = await listReleases(async () =>
      Response.json([rel('v0.4.0', false), rel('v0.6.0'), rel('v0.5.0')]),
    )
    expect(list.map((r) => r.version)).toEqual(['0.6.0', '0.5.0'])
  })

  it('skips pull request test builds', async () => {
    const list = await listReleases(async () =>
      Response.json([rel('pr-74', true, true), rel('v1.0.0')]),
    )
    expect(list.map((r) => r.version)).toEqual(['1.0.0'])
  })

  it('offers betas only on the beta channel', async () => {
    const list = await listReleases(async () =>
      Response.json([
        rel('v1.0.0'),
        rel('v1.1.0-beta.1', true, true),
        rel('v1.0.1'),
        // Marked as a pre-release on GitHub without a -suffix still counts as a beta.
        rel('v1.0.2', true, true),
      ]),
    )
    expect(onChannel(list, 'stable').map((r) => r.version)).toEqual(['1.0.1', '1.0.0'])
    expect(onChannel(list, 'beta')[0]?.version).toBe('1.1.0-beta.1')
    expect(list.find((r) => r.version === '1.1.0-beta.1')?.prerelease).toBe(true)
  })

  it('offers the stable release over its own betas', async () => {
    const list = await listReleases(async () =>
      Response.json([rel('v1.1.0-beta.2', true, true), rel('v1.1.0')]),
    )
    expect(onChannel(list, 'beta')[0]?.version).toBe('1.1.0')
  })

  it('defaults to beta only when a beta is running', () => {
    expect(defaultChannel('1.0.1')).toBe('stable')
    expect(defaultChannel('1.1.0-beta.1')).toBe('beta')
  })

  it('remembers the chosen channel', () => {
    const db = openDb(':memory:')
    expect(getSetting(db, 'update.channel')).toBeUndefined()
    setSetting(db, 'update.channel', 'beta')
    expect(getSetting(db, 'update.channel')).toBe('beta')
    setSetting(db, 'update.channel', 'stable')
    expect(getSetting(db, 'update.channel')).toBe('stable')
  })
})
