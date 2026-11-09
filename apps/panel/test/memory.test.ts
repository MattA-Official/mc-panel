import { describe, expect, it } from 'bun:test'
import { budgetProblem, maxHeapFor, memoryBudget } from '../server/memory'

const survival = { name: 'survival', displayName: 'Survival', memoryMb: 6144 }
const creative = { name: 'creative', displayName: 'Creative', memoryMb: 2048 }

describe('memory budget', () => {
  it('adds up what servers are given', () => {
    expect(memoryBudget(16384, [survival, creative])).toMatchObject({
      budgetMb: 15360,
      givenMb: 6656 + 2560,
      freeMb: 15360 - 9216,
    })
  })

  it('fits a 6 GB server on an 8 GB machine', () => {
    expect(maxHeapFor(8192, [])).toBe(6656)
    expect(budgetProblem(8192, [], { name: 'survival', memoryMb: 6144 })).toBeNull()
  })

  it('refuses more than there is room for, naming the other servers', () => {
    const problem = budgetProblem(8192, [survival], { name: 'creative', memoryMb: 2048 })
    expect(problem).toContain('at most 0 GB')
    expect(problem).toContain('Survival has 6 GB')
    expect(
      budgetProblem(16384, [survival, creative], { name: 'creative', memoryMb: 8192 }),
    ).toBeNull()
  })

  it('always lets a server go down, even when over', () => {
    expect(budgetProblem(4096, [survival], { name: 'survival', memoryMb: 4096 })).toBeNull()
    expect(budgetProblem(4096, [survival], { name: 'survival', memoryMb: 7168 })).not.toBeNull()
  })
})
