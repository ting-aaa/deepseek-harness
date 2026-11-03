/** Behavioral fixtures derived independently from upstream recursion.py, not schedule generation. */
import { expect, it } from 'vitest'
import { runSchedule } from '../src/schedule.ts'
import type { ImprovementEvidence, ScheduleAdapter } from '../src/schedule.ts'
import { parallelTwo, sequentialTwo } from './upstream-recursion-fixtures.ts'

function recorder() {
  const stages: string[] = []
  const rollouts: string[] = []
  const evidence = new Map<string, ImprovementEvidence<string>>()
  const adapter: ScheduleAdapter<string> = {
    async rollout(label, candidate) {
      rollouts.push(label)
      return { label, candidate, answer: `answer:${label}:${candidate}` }
    },
    async improve(label, _dimension, input) {
      stages.push(label)
      evidence.set(label, structuredClone(input))
      return { candidate: label, rationale: `decision:${label}`, attempts: 1, inherited: false }
    },
  }
  return { adapter, stages, rollouts, evidence }
}

it('matches upstream parallel k=2 shared baselines, independent compositions and finals-only pool', async () => {
  const run = recorder()
  const result = await runSchedule('parallel', 2, 'base-tree', run.adapter)
  expect(run.stages).toEqual(parallelTwo.stages)
  expect(run.rollouts).toEqual(parallelTwo.rollouts)
  expect(result.finals.map(item => item.label)).toEqual(parallelTwo.finals)
  expect(result.finals.map(item => item.answer)).toEqual(['answer:agg1:agg1', 'answer:agg2:agg2'])
  for (const label of parallelTwo.stages) {
    const seen = run.evidence.get(label)!
    expect(seen.baseline.map(item => item.label)).toEqual(parallelTwo.bases)
    expect(seen.baseline.map(item => item.candidate)).toEqual(['base-tree', 'base-tree'])
    expect(seen.current).toBe('base-tree')
    expect(seen.history.map(item => item.label)).toEqual(label.startsWith('agg') ? parallelTwo.candidatePool : [])
    expect(Object.keys(seen.decisions)).toEqual(label.startsWith('agg') ? parallelTwo.candidatePool : [])
  }
  expect(Object.keys(result.decisions)).toEqual(parallelTwo.stages)
})

it('matches upstream sequential k=2 inherited composition, growing history and all round finals', async () => {
  const run = recorder()
  const result = await runSchedule('sequential', 2, 'base-tree', run.adapter)
  expect(run.stages).toEqual(sequentialTwo.stages)
  expect(run.rollouts).toEqual(sequentialTwo.rollouts)
  expect(result.finals.map(item => item.label)).toEqual(sequentialTwo.finals)
  expect(result.finals.map(item => item.answer)).toEqual(['answer:c1:c1', 'answer:c2:c2'])
  for (const label of sequentialTwo.stages) {
    const seen = run.evidence.get(label)!
    expect(seen.baseline.map(item => item.label)).toEqual(sequentialTwo.bases)
    expect(seen.baseline.map(item => item.candidate)).toEqual(['base-tree', 'base-tree'])
    expect(seen.current).toBe(label.endsWith('2') ? 'c1' : 'base-tree')
    expect(seen.history.map(item => item.label)).toEqual(sequentialTwo.pools[label])
    expect(Object.keys(seen.decisions)).toEqual(sequentialTwo.pools[label])
  }
})

it.each(['parallel', 'sequential'] as const)('%s k=1 preserves exactly four executions and three improvement stages', async (mode) => {
  const run = recorder()
  const result = await runSchedule(mode, 1, 'base-tree', run.adapter)
  expect(run.rollouts).toHaveLength(4)
  expect(run.stages).toHaveLength(3)
  expect(result.finals.map(item => item.label)).toEqual([mode === 'parallel' ? 'agg1' : 'c1'])
  expect(result.baseline).toHaveLength(1)
})

it('uses inherited candidates as actual rollout inputs rather than merely logging fallback', async () => {
  const run = recorder()
  const result = await runSchedule('sequential', 2, 'base-tree', {
    ...run.adapter,
    async improve(label, dimension, evidence) {
      if (label === 'c2') return { candidate: evidence.current, rationale: 'invalid twice; inherited', attempts: 2, inherited: true }
      return run.adapter.improve(label, dimension, evidence)
    },
  })
  expect(result.finals.map(item => item.candidate)).toEqual(['c1', 'c1'])
  expect(result.finals[1]!.answer).toBe('answer:c2:c1')
  expect(result.decisions.c2).toMatchObject({ attempts: 2, inherited: true })
})

it('drains a failed parallel phase before rejection and never starts its dependent phase', async () => {
  const siblingStarted = Promise.withResolvers<undefined>()
  const releaseSibling = Promise.withResolvers<undefined>()
  let siblingFinished = false
  let proposals = 0
  const failure = new Error('baseline transport failed')
  const result = runSchedule('parallel', 2, 'base-tree', {
    async rollout(label, candidate) {
      if (label === 'base1') throw failure
      siblingStarted.resolve(undefined)
      await releaseSibling.promise
      siblingFinished = true
      return { label, candidate, answer: 'second baseline' }
    },
    async improve() {
      proposals += 1
      throw new Error('must not run')
    },
  })
  const checked = expect(result).rejects.toBe(failure)
  await siblingStarted.promise
  expect(siblingFinished).toBe(false)
  releaseSibling.resolve(undefined)
  await checked
  expect(siblingFinished).toBe(true)
  expect(proposals).toBe(0)
})

it('keeps evidence in canonical order when independent model calls finish in reverse order', async () => {
  const run = recorder()
  const bothStarted = Promise.withResolvers<undefined>()
  const first = Promise.withResolvers<undefined>()
  const second = Promise.withResolvers<undefined>()
  const secondFinished = Promise.withResolvers<undefined>()
  const completed: string[] = []
  let started = 0
  const pending = runSchedule('parallel', 2, 'base-tree', {
    ...run.adapter,
    async rollout(label, candidate) {
      if (label.startsWith('base')) {
        started += 1
        if (started === 2) bothStarted.resolve(undefined)
        await (label === 'base1' ? first.promise : second.promise)
        completed.push(label)
        if (label === 'base2') secondFinished.resolve(undefined)
      }
      return run.adapter.rollout(label, candidate)
    },
  })
  await bothStarted.promise
  second.resolve(undefined)
  await secondFinished.promise
  first.resolve(undefined)
  const result = await pending
  expect(completed).toEqual(['base2', 'base1'])
  expect(result.baseline.map(item => item.label)).toEqual(parallelTwo.bases)
  expect(run.evidence.get('inv1')!.baseline.map(item => item.label)).toEqual(parallelTwo.bases)
})

it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid k=%s before any child execution', async (k) => {
  const run = recorder()
  await expect(runSchedule('parallel', k, 'base-tree', run.adapter)).rejects.toThrow('positive safe integer')
  expect(run.rollouts).toEqual([])
  expect(run.stages).toEqual([])
})
