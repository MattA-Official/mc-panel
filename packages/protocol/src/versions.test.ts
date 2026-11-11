import { describe, expect, it } from 'bun:test'
import { compareVersions } from './versions'

describe('compareVersions', () => {
  it('orders releases, pre-releases and native builds as the Rust agent does', () => {
    const newestFirst = [
      '1.5.0',
      '1.5.0-beta.10',
      '1.5.0-beta.9',
      '1.4.1',
      '1.4.0',
      '1.4.0-native.1',
      '1.4.0-beta.2.native.1',
      '1.4.0-beta.2',
      '0.9.0',
    ]
    newestFirst.forEach((a, i) =>
      newestFirst.forEach((b, j) =>
        expect(Math.sign(compareVersions(a, b))).toBe(Math.sign(j - i)),
      ),
    )
  })
})
