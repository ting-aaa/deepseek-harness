/** External artifact grading rejects errors without consulting model self-evaluations. */
import { expect, it } from 'vitest'
import { SUITE, grade } from '../evaluation/suite.ts'

it('keeps training and held-out ids disjoint and grades signed, empty and ordered results', () => {
  expect(new Set(SUITE.map(task => task.id)).size).toBe(SUITE.length)
  expect(SUITE.filter(task => task.split === 'train')).toHaveLength(2)
  expect(SUITE.filter(task => task.split === 'held-out')).toHaveLength(4)
  const task = SUITE.find(task => task.id === 'held-order')!
  const correct = [{ account: 'A', total: 0 }, { account: 'B', total: 2 }, { account: 'a', total: 3 }]
  expect(grade(task, correct, task.rows).passed).toBe(true)
  expect(grade(task, [...correct].reverse(), task.rows).passed).toBe(false)
  expect(grade(task, correct.slice(1), task.rows).passed).toBe(false)
  expect(grade(task, correct, [])).toEqual({ passed: false, reason: 'input-modified' })
  expect(grade(task, undefined, task.rows).passed).toBe(false)
  const empty = SUITE.find(item => item.id === 'held-empty')!
  expect(grade(empty, [], []).passed).toBe(true)
})
