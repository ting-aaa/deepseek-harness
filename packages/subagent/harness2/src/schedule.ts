// Copyright 2026 Google LLC
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied. See the License for the
// specific language governing permissions and limitations under the License.
// Modified: translated core/recursion.py scheduling semantics to native DSH TypeScript.

/** Native parallel and sequential Harness² recursion with stable evidence ordering. @module */

/** Editable candidate plus the decision that produced it. */
export interface Proposal<T> {
  readonly candidate: T
  readonly rationale: string
  readonly attempts: number
  readonly inherited: boolean
}

/** One observed rollout; failures remain explicit evidence, never fabricated answers. */
export interface Rollout<T> {
  readonly label: string
  readonly candidate: T
  readonly answer: string
  readonly error?: string | undefined
  readonly trajectory?: string | undefined
}

/** Shared baseline evidence and the candidate history available to an improvement stage. */
export interface ImprovementEvidence<T> {
  readonly baseline: readonly Rollout<T>[]
  readonly history: readonly Rollout<T>[]
  readonly current: T
  readonly decisions: Readonly<Record<string, Proposal<T>>>
}

/** Native execution callbacks own logging, checkpoints, budgets, and candidate validation. */
export interface ScheduleAdapter<T> {
  readonly rollout: (label: string, candidate: T) => Promise<Rollout<T>>
  readonly improve: (label: string, dimension: 'invariant' | 'domain' | 'compose', evidence: ImprovementEvidence<T>) => Promise<Proposal<T>>
}

/** All composed candidates remain eligible; neither baselines nor probes enter selection. */
export interface ScheduleResult<T> {
  readonly baseline: readonly Rollout<T>[]
  readonly history: readonly Rollout<T>[]
  readonly finals: readonly Rollout<T>[]
  readonly decisions: Readonly<Record<string, Proposal<T>>>
}

/**
 * Run 4k rollouts and 3k improvement stages, excluding retries, selection and reflection.
 * Parallel phases drain every sibling before propagating failure.
 * @param mode - independent parallel composition or sequential growing history.
 * @param k - positive recursion width/depth validated by the caller.
 * @param base - immutable starting candidate reused by every baseline.
 * @param adapter - logged, checkpointed execution operations.
 * @returns ordered baselines, history, final candidates, and decisions.
 */
export async function runSchedule<T>(mode: 'parallel' | 'sequential', k: number, base: T, adapter: ScheduleAdapter<T>): Promise<ScheduleResult<T>> {
  if (!Number.isSafeInteger(k) || k < 1) throw new TypeError('Harness² k must be a positive safe integer')
  const indices = Array.from({ length: k }, (_, i) => i + 1)
  const baseline = await drain(indices.map(i => adapter.rollout(`base${i}`, base)))
  if (!baseline.some(rollout => rollout.error === undefined)) throw new Error(`Harness² no base rollout produced an answer: ${baseline.map(rollout => rollout.error).join('; ')}`)
  const decisions: Record<string, Proposal<T>> = {}
  let history: Rollout<T>[] = []
  const finals: Rollout<T>[] = []
  const improve = async (label: string, dimension: 'invariant' | 'domain' | 'compose', current: T, pool: readonly Rollout<T>[]) => {
    const proposal = await adapter.improve(label, dimension, { baseline, history: [...pool], current, decisions: { ...decisions } })
    return { label, proposal }
  }
  const record = (items: readonly { label: string; proposal: Proposal<T> }[]) => {
    for (const item of items) decisions[item.label] = item.proposal
  }
  if (mode === 'parallel') {
    const proposals = await drain(indices.flatMap(i => [improve(`inv${i}`, 'invariant', base, []), improve(`dom${i}`, 'domain', base, [])]))
    record(proposals)
    history = await drain(proposals.map(({ label, proposal }) => adapter.rollout(label, proposal.candidate)))
    const composed = await drain(indices.map(i => improve(`agg${i}`, 'compose', base, history)))
    record(composed)
    finals.push(...await drain(composed.map(({ label, proposal }) => adapter.rollout(label, proposal.candidate))))
    history.push(...finals)
  } else {
    let current = base
    for (const i of indices) {
      const proposals = await drain([improve(`inv${i}`, 'invariant', current, history), improve(`dom${i}`, 'domain', current, history)])
      record(proposals)
      history.push(...await drain(proposals.map(({ label, proposal }) => adapter.rollout(label, proposal.candidate))))
      const composed = await improve(`c${i}`, 'compose', current, history)
      record([composed])
      const final = await adapter.rollout(composed.label, composed.proposal.candidate)
      finals.push(final)
      history.push(final)
      current = composed.proposal.candidate
    }
  }
  return { baseline, history, finals, decisions }
}

async function drain<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises)
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
}
