import { describe, expect, test } from 'bun:test'
import { mayServeHost, routeHost } from '../server/status/hosts'

const on = { name: 'survival', publicPage: true }
const at = (path: string, server: typeof on | null = on, host = 'survival.example.com') =>
  routeHost({ host, path, panelDomain: 'panel.example.com', server }).kind

describe('server hostnames', () => {
  test("the panel's own domain and unknown names are the panel", () => {
    expect(at('/', on, 'panel.example.com')).toBe('panel')
    expect(at('/', on, 'PANEL.example.com')).toBe('panel')
    expect(at('/', null)).toBe('panel')
  })

  test('the root goes to the status page', () => {
    expect(
      routeHost({
        host: 'survival.example.com',
        path: '/',
        panelDomain: 'panel.example.com',
        server: on,
      }),
    ).toEqual({
      kind: 'redirect',
      to: '/s/survival',
    })
  })

  test('only the page and what it needs are served', () => {
    for (const p of [
      '/s/survival',
      '/api/public/servers/survival',
      '/api/public/servers/survival/pack.mrpack',
      '/api/public/servers/survival/skins/abc.png',
      '/api/branding',
      '/branding/theme.css',
      '/_nuxt/entry.js',
      '/favicon.ico',
      '/flytower-mark.svg',
    ]) {
      expect(at(p)).toBe('allow')
    }
    for (const p of [
      '/login',
      '/setup',
      '/servers/survival',
      '/s/creative',
      '/api/public/servers/creative',
      '/api/servers',
      '/api/auth/state',
      '/api/public/servers/survivalx',
    ]) {
      expect(at(p)).toBe('not-found')
    }
  })

  test('a hostname whose page is off serves nothing', () => {
    expect(at('/', { name: 'survival', publicPage: false })).toBe('not-found')
    expect(at('/s/survival', { name: 'survival', publicPage: false })).toBe('not-found')
  })

  test('certificates only for public pages', () => {
    expect(mayServeHost(null)).toBe(false)
    expect(mayServeHost({ publicPage: false })).toBe(false)
    expect(mayServeHost({ publicPage: true })).toBe(true)
  })
})
