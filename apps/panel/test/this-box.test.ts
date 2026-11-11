import { describe, expect, test } from 'bun:test'
import { isFromThisBox } from '../server/utils/this-box'

describe('isFromThisBox', () => {
  test('a loopback peer without the proxy header is this machine', () => {
    expect(isFromThisBox({ ip: '127.0.0.1' })).toBe(true)
    expect(isFromThisBox({ ip: '::1' })).toBe(true)
    expect(isFromThisBox({ ip: '::ffff:127.0.0.1' })).toBe(true)
  })

  test('anything through the proxy is not', () => {
    expect(isFromThisBox({ forwardedFor: '203.0.113.9', ip: '127.0.0.1' })).toBe(false)
    expect(isFromThisBox({ forwardedFor: '127.0.0.1', listenHost: '127.0.0.1' })).toBe(false)
  })

  test('another peer is not', () => {
    expect(isFromThisBox({ ip: '203.0.113.9', listenHost: '127.0.0.1' })).toBe(false)
  })

  // Bun's server under Nitro gives no peer address, which made the updater's health check
  // see no version and roll every update back.
  test('with no peer address, a panel listening on loopback can only be reached from here', () => {
    expect(isFromThisBox({ ip: undefined, listenHost: '127.0.0.1' })).toBe(true)
    expect(isFromThisBox({ ip: undefined, listenHost: '0.0.0.0' })).toBe(false)
    expect(isFromThisBox({ ip: undefined, listenHost: undefined })).toBe(false)
  })
})
