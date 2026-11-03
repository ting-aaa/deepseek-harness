/** Independent artifact scoring for a fixed train/held-out ledger workload. @module */
import { isDeepStrictEqual } from 'node:util'

/** One public task fixture. Its expected result is computed only by the evaluator. */
export interface LedgerTask {
  readonly id: string
  readonly split: 'train' | 'held-out'
  readonly rows: readonly { account: string; amount: number }[]
}

/** The same task specification reaches both ordinary and optimized Agents. */
export const TASK = 'Read input.json, an array of ledger rows with account and integer amount. '
  + 'Write output.json as an array of {account,total}, one row per account, summing signed amounts, '
  + 'including zero totals, sorted by account in ascending ASCII order. Do not modify input.json. '
  + 'Return the file and describe any checks. Do not include any other fields.'

/** Disjoint, fixed examples; held-out tasks never enter the experience library. */
export const SUITE: readonly LedgerTask[] = [
  { id: 'train-basic', split: 'train', rows: [
    { account: 'B', amount: 4 }, { account: 'A', amount: 2 }, { account: 'B', amount: -1 },
  ] },
  { id: 'train-zero', split: 'train', rows: [
    { account: 'C', amount: 10 }, { account: 'C', amount: -10 }, { account: 'A', amount: -3 },
  ] },
  { id: 'held-empty', split: 'held-out', rows: [] },
  { id: 'held-signed', split: 'held-out', rows: [
    { account: 'Z', amount: -7 }, { account: 'Z', amount: 2 }, { account: 'A', amount: 1 },
  ] },
  { id: 'held-order', split: 'held-out', rows: [
    { account: 'a', amount: 3 }, { account: 'B', amount: 2 }, { account: 'A', amount: 0 },
  ] },
  { id: 'held-repeat', split: 'held-out', rows: [
    { account: 'X', amount: 100 }, { account: 'Y', amount: -8 }, { account: 'X', amount: -99 },
    { account: 'Y', amount: 8 }, { account: 'X', amount: -1 },
  ] },
]

/**
 * Grade exact artifact semantics and source preservation without executing generated code.
 * @param task - Evaluator-owned input fixture.
 * @param output - Parsed output.json, or undefined when missing or invalid.
 * @param input - Parsed input.json after the Agent finishes.
 * @returns An externally computed pass/fail and actionable mismatch class.
 */
export function grade(task: LedgerTask, output: unknown, input: unknown): { passed: boolean; reason: string } {
  if (!isDeepStrictEqual(input, task.rows)) return { passed: false, reason: 'input-modified' }
  const sums = new Map<string, number>()
  for (const row of task.rows) sums.set(row.account, (sums.get(row.account) ?? 0) + row.amount)
  const expected = [...sums.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([account, total]) => ({ account, total }))
  return isDeepStrictEqual(output, expected) ? { passed: true, reason: 'exact-artifact' }
    : { passed: false, reason: 'output-mismatch' }
}
