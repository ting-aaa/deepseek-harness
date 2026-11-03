/** Budget and validation regressions through the real child runtime. */
import { expect, it } from 'vitest'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'

const signal = (): AbortSignal => new AbortController().signal

it('rejects an oversized task before starting children or writing a preview', async () => {
  const model = new MockAdapter([])
  const { ctx, parent, sessions, path } = await bootHarness(model, { maxTaskChars: 3 })
  expect(() => ctx.harness2.run({ parent, task: 'four', domain: 'text', signal: signal() })).toThrow('at most 3')
  expect(sessions).toHaveLength(1)
  expect(model.requests).toEqual([])
  expect(storedRecords(path, 'previews')).toEqual([])
})

it('rejects the complete serialized message instead of silently trimming evidence', async () => {
  const model = new MockAdapter([])
  const { ctx, parent, sessions } = await bootHarness(model, { maxEvidenceChars: 1 })
  await expect(ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: signal() })).rejects.toThrow('complete child message')
  expect(sessions).toHaveLength(1)
  expect(model.requests).toEqual([])
})

it('rejects a missing fresh provider before creating children', async () => {
  const model = new MockAdapter([])
  const { ctx, parent } = await bootHarness(model, { provider: 'missing' })
  expect(() => ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: signal() })).toThrow('fresh local children')
  expect(model.requests).toEqual([])
})

it('honors an already cancelled request without issuing model calls', async () => {
  const model = new MockAdapter([])
  const { ctx, parent } = await bootHarness(model)
  const abort = new AbortController()
  abort.abort(new Error('cancel-before-start'))
  expect(() => ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: abort.signal })).toThrow('cancel-before-start')
  expect(model.requests).toEqual([])
})

it('bounds empty-message tool continuations by admitted step count', async () => {
  const model = new MockAdapter([
    toolCallResponse('bad-1', 'structured_output', { wrong: 'field' }),
    toolCallResponse('bad-2', 'structured_output', { wrong: 'field' }),
    toolCallResponse('would-be-third', 'structured_output', { answer: 'must never be requested' }),
  ])
  const { ctx, parent, sessions, path } = await bootHarness(model, { maxStepsPerChild: 2 })
  await expect(ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: signal() })).rejects.toThrow()
  expect(model.requests).toHaveLength(2)
  expect(sessions).toHaveLength(2)
  expect(ctx.agents.get(sessions[1]!.id)).toBeUndefined()
  expect(storedRecords(path, 'previews')).toEqual([])
})

it.each([
  ['unfinished token-limited answer', maxTokensResponse('partial')],
  ['plain text without structured output', textResponse('not a structured answer')],
])('does not save %s', async (_name, response) => {
  const model = new MockAdapter([response])
  const { ctx, parent, sessions, path } = await bootHarness(model)
  await expect(ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: signal() })).rejects.toThrow()
  expect(ctx.agents.get(sessions[1]!.id)).toBeUndefined()
  expect(storedRecords(path, 'previews')).toEqual([])
})

it('rejects a completed but oversized answer before starting improvement stages', async () => {
  const model = new MockAdapter([toolCallResponse('answer', 'structured_output', { answer: 'too long' })])
  const { ctx, parent, path } = await bootHarness(model, { maxOutputChars: 3 })
  await expect(ctx.harness2.run({ parent, task: 'task', domain: 'text', signal: signal() })).rejects.toThrow('answer')
  expect(model.requests).toHaveLength(1)
  expect(storedRecords(path, 'previews')).toEqual([])
})

it('serializes retention and insertion when two previews finish together', async () => {
  const bothReflecting = Promise.withResolvers<undefined>()
  let reflections = 0
  class ConcurrentModel extends LlmAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const content = JSON.stringify(options.messages)
      let output: object
      if (content.includes('Reflect on the baseline')) {
        reflections += 1
        if (reflections === 2) bothReflecting.resolve(undefined)
        await bothReflecting.promise
        output = { lesson: 'An observed limitation.' }
      } else if (content.includes('Produce the best complete text answer')) {
        output = { answer: 'A bounded answer.' }
      } else {
        output = { tree: JSON.stringify({ 'systemprompt.md': 'Check the premises.' }), rationale: 'Keep assumptions explicit.' }
      }
      yield* toolCallResponse('structured', 'structured_output', output)
    }
  }
  const { ctx, parent, path } = await bootHarness(new ConcurrentModel(), { maxConcurrentRuns: 2, maxSavedRuns: 1 })
  const request = { parent, task: 'Explain the argument.', domain: 'retention', signal: signal() }
  const results = await Promise.all([ctx.harness2.run(request), ctx.harness2.run(request)])
  expect(reflections).toBe(2)
  expect(new Set(results.map(result => result.runId)).size).toBe(2)
  expect(storedRecords(path, 'previews')).toHaveLength(1)
})
