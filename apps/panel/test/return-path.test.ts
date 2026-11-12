import { expect, test } from 'bun:test'
import { returnPath } from '../app/utils/return-path'

test('returnPath keeps a path on this panel', () => {
  expect(returnPath('/servers/nnt/files?path=/mods')).toBe('/servers/nnt/files?path=/mods')
  expect(returnPath('/')).toBe('/')
})

test('returnPath refuses anything that could leave the panel', () => {
  for (const bad of [
    undefined,
    ['/servers'],
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/\t/example.com',
    'javascript:alert(1)',
  ]) {
    expect(returnPath(bad)).toBe('/')
  }
})

test('returnPath skips the sign-in pages themselves', () => {
  expect(returnPath('/login')).toBe('/')
  expect(returnPath('/login?next=/x')).toBe('/')
  expect(returnPath('/enrol')).toBe('/')
})
