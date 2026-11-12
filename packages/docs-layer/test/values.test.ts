import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { docValue, valuesInMarkdown } from '../values'

const docsDir = resolve(import.meta.dir, '../../../docs')

describe('live values', () => {
  test('valuesInMarkdown finds each value', () => {
    expect(
      valuesInMarkdown('Join :value{of="server.address"} on :value[it]{of="server.version"}.'),
    ).toEqual(['server.address', 'server.version'])
  })

  test('docValue only knows listed values', () => {
    expect(docValue('server.address')?.fallback).toBe("your server's address")
    expect(docValue('toString')).toBeNull()
  })

  test('every value the docs show is listed', () => {
    const problems: string[] = []
    for (const file of readdirSync(docsDir).filter((f) => f.endsWith('.md'))) {
      for (const of of valuesInMarkdown(readFileSync(join(docsDir, file), 'utf8'))) {
        if (!docValue(of)) problems.push(`${file}: no value "${of}" in values.ts`)
      }
    }
    expect(problems).toEqual([])
  })
})
