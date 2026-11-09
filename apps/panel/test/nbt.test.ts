import { describe, expect, it } from 'bun:test'
import { readNbt, worldVersion } from '../server/imports/nbt'
import { levelDat } from './helpers/level-dat'

describe('readNbt', () => {
  it('reads a gzipped level.dat', () => {
    const level = readNbt(levelDat('26.3'))
    const data = level.Data as Record<string, unknown>
    expect(data.LevelName).toBe('Survïval')
    expect(data.RandomSeed).toBe(42n)
    expect(data.ServerBrands).toEqual(['vanilla', 'fabric'])
    expect(Array.from(data.Ints as Int32Array)).toEqual([-1, 7])
    expect(worldVersion(level)).toEqual({ name: '26.3', dataVersion: 4555 })
  })

  it('reads uncompressed NBT and copes without a version', () => {
    expect(worldVersion(readNbt(levelDat(null, false)))).toEqual({ name: null, dataVersion: 4555 })
  })

  it('refuses truncated and nonsense files', () => {
    const full = levelDat('26.3', false)
    expect(() => readNbt(full.slice(0, 20))).toThrow('cut short')
    expect(() => readNbt(new Uint8Array([1, 2, 3]))).toThrow("doesn't start")
  })
})
