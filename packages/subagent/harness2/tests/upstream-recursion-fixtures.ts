/** Independently transcribed from harness2/core/recursion.py and selection.py.
 * These expectations deliberately do not call the native scheduler to construct themselves.
 */
export const parallelTwo = {
  bases: ['base1', 'base2'],
  stages: ['inv1', 'dom1', 'inv2', 'dom2', 'agg1', 'agg2'],
  finals: ['agg1', 'agg2'],
  candidatePool: ['inv1', 'dom1', 'inv2', 'dom2'],
  rollouts: ['base1', 'base2', 'inv1', 'dom1', 'inv2', 'dom2', 'agg1', 'agg2'],
} as const

export const sequentialTwo = {
  bases: ['base1', 'base2'],
  stages: ['inv1', 'dom1', 'c1', 'inv2', 'dom2', 'c2'],
  finals: ['c1', 'c2'],
  pools: {
    inv1: [], dom1: [], c1: ['inv1', 'dom1'],
    inv2: ['inv1', 'dom1', 'c1'], dom2: ['inv1', 'dom1', 'c1'],
    c2: ['inv1', 'dom1', 'c1', 'inv2', 'dom2'],
  },
  rollouts: ['base1', 'base2', 'inv1', 'dom1', 'c1', 'inv2', 'dom2', 'c2'],
} as const
