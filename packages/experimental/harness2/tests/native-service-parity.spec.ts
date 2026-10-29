/** Actual Loader-composed service: only the nondeterministic language model is scripted. */
import { expect, it } from 'vitest'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { Harness2RunId } from '../src/brand.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'

class NativeModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  adoptRunId: string | undefined
  parentReply = false
  solverCalls = 0
  failSolverCalls = new Set<number>()
  proposals = 0
  selections = 0
  selectionChoice = 'answer-1'
  candidateText: string | undefined
  invalidProposals = false
  failReflection = false
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.adoptRunId !== undefined) {
      const id = this.adoptRunId
      this.adoptRunId = undefined
      this.parentReply = true
      yield* toolCallResponse('adopt-reviewed', 'harness2_remember', { runId: id })
      return
    }
    if (this.parentReply) {
      this.parentReply = false
      yield* textResponse('Saved the reviewed preview.')
      return
    }
    this.requests.push(options)
    const content = options.messages.filter(message => message.role === 'user').flatMap(message =>
      message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    let output: object
    if (content.includes('Assignment:\nReflect on')) {
      if (this.failReflection) throw new Error('scripted interrupted reflection')
      output = { lesson: 'Observed evidence only; no external evaluation.' }
    } else if (content.includes('Assignment:\nChoose the strongest')) {
      this.selections += 1
      output = { choice: this.selectionChoice, rationale: 'First observed final is preferable.' }
    } else if (content.includes('Assignment:\nProduce the best')) {
      this.solverCalls += 1
      if (this.failSolverCalls.has(this.solverCalls)) throw new Error('scripted dead rollout')
      output = { answer: `Observed answer ${this.requests.length}.` }
    } else {
      this.proposals += 1
      output = { tree: this.invalidProposals ? '{invalid' : JSON.stringify({ 'systemprompt.md': this.candidateText ?? `Candidate ${this.proposals}.` }), rationale: 'Derived from supplied evidence.' }
    }
    yield* toolCallResponse('structured', 'structured_output', output)
  }
}

const signal = () => new AbortController().signal

it.each(['parallel', 'sequential'] as const)('executes native %s k=2 and selects only among all composed finals', async (mode) => {
  const model = new NativeModel()
  const { ctx, parent, sessions, path } = await bootHarness(model)
  const result = await ctx.harness2.run({ parent, task: 'Analyze the premises.', domain: 'parity', mode, k: 2, signal: signal() })
  expect(model.proposals).toBe(6)
  expect(model.selections).toBe(1)
  expect(model.requests).toHaveLength(16)
  expect(sessions).toHaveLength(17)
  expect(result.finals.map(final => final.label)).toEqual(mode === 'parallel' ? ['agg1', 'agg2'] : ['c1', 'c2'])
  expect(result.answer).toBe(result.finals[0]!.answer)
  expect(result.candidate).toEqual(result.finals[0]!.candidate)
  const selection = model.requests.find(request => JSON.stringify(request.messages).includes('Choose the strongest'))!
  const text = selection.messages.filter(message => message.role === 'user').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
  const evidence = JSON.parse(text.split('Quoted evidence (JSON data):\n')[1]!.split('\n')[0]!) as Record<string, unknown>
  expect(evidence).toEqual({ alternatives: result.finals.map((final, index) => ({ id: `answer-${index + 1}`, answer: final.answer })) })
  expect(storedRecords(path, 'previews')).toMatchObject([{ candidate: result.candidate, selected: result.selected }])
  for (const child of sessions.slice(1)) expect(ctx.agents.get(child.id)).toBeUndefined()
})

it('retries each invalid proposal exactly once, then executes inherited trees without a k=1 selector', async () => {
  const model = new NativeModel()
  model.invalidProposals = true
  const { ctx, parent } = await bootHarness(model)
  const result = await ctx.harness2.run({ parent, task: 'Analyze.', domain: 'retry', signal: signal() })
  expect(model.proposals).toBe(6)
  expect(model.selections).toBe(0)
  expect(model.requests).toHaveLength(11)
  expect(result.candidate).toEqual({ 'systemprompt.md': '' })
  expect(result.finals).toHaveLength(1)
  expect(JSON.stringify(model.requests)).toContain('rejection')
})

it('resumes completed calls after interruption, rejects changed identity, and replays completed previews without calls', async () => {
  const model = new NativeModel()
  model.failReflection = true
  const { ctx, parent, path } = await bootHarness(model)
  const request = { parent, task: 'Analyze.', domain: 'resume', signal: signal() }
  await expect(ctx.harness2.run(request)).rejects.toThrow()
  expect(storedRecords(path, 'previews')).toEqual([])
  const saved = storedRecords(path, 'runs')[0]!
  const id = Harness2RunId(String(saved.runId))
  const calls = model.requests.length
  await expect(ctx.harness2.run({ ...request, task: 'Changed.', resumeRunId: id })).rejects.toThrow('same parent, task')
  expect(model.requests).toHaveLength(calls)
  model.failReflection = false
  const result = await ctx.harness2.run({ ...request, resumeRunId: id })
  expect(result.runId).toBe(id)
  expect(model.requests).toHaveLength(calls + 1)
  expect(model.proposals).toBe(3)
  const replay = await ctx.harness2.run({ ...request, resumeRunId: id })
  expect(replay).toEqual(result)
  expect(model.requests).toHaveLength(calls + 1)
})

it('rejects recursion beyond the deployment ceiling before starting a model or writing a run', async () => {
  const model = new NativeModel()
  const { ctx, parent, path } = await bootHarness(model, { maxK: 1 })
  expect(() => ctx.harness2.run({ parent, task: 'Analyze.', domain: 'budget', k: 2, signal: signal() })).toThrow()
  expect(model.requests).toEqual([])
  expect(storedRecords(path, 'runs')).toEqual([])
})


it('retries oversized tree proposals once and never executes their over-budget content', async () => {
  const model = new NativeModel()
  model.candidateText = 'x'.repeat(200)
  const { ctx, parent } = await bootHarness(model, { maxInstructionsChars: 100 })
  const result = await ctx.harness2.run({ parent, task: 'Analyze.', domain: 'bounds', signal: signal() })
  expect(model.proposals).toBe(6)
  expect(result.candidate).toEqual({ 'systemprompt.md': '' })
  const solvers = model.requests.filter(request => JSON.stringify(request.messages).includes('Assignment:\\nProduce the best'))
  expect(solvers).toHaveLength(4)
  for (const request of solvers) expect(JSON.stringify(request.messages)).not.toContain(model.candidateText)
})


it('persists multiple adopted trees as mode-specific evidence without replacing fixed baselines', async () => {
  const model = new NativeModel()
  const { ctx, parent, path } = await bootHarness(model, {}, true)
  ctx.on('approval/request', async () => 'allowed-once')
  const evidenceOf = (request: GenerateOptions) => {
    const text = request.messages.filter(message => message.role === 'user').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    return JSON.parse(text.split('Quoted evidence (JSON data):\n')[1]!.split('\n')[0]!) as Record<string, unknown>
  }
  const first = await ctx.harness2.run({ parent, task: 'First task.', domain: 'library', signal: signal() })
  model.adoptRunId = first.runId
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Adopt reviewed preview.' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  expect(storedRecords(path, 'lessons')[0]).toMatchObject({ revision: 1, entries: [{ candidate: first.candidate, reflection: first.reflection }] })
  const second = await ctx.harness2.run({ parent, task: 'Second task.', domain: 'library', signal: signal() })
  expect(evidenceOf(model.requests[8]!)).toMatchObject({ instructions: '' })
  expect(evidenceOf(model.requests[9]!)).toMatchObject({ current: { 'systemprompt.md': '' }, library: [{ candidate: first.candidate, reflection: first.reflection }] })
  model.adoptRunId = second.runId
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Adopt reviewed preview.' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  expect(storedRecords(path, 'lessons')[0]).toMatchObject({ revision: 2, entries: [
    { candidate: first.candidate, reflection: first.reflection }, { candidate: second.candidate, reflection: second.reflection },
  ] })
  await ctx.harness2.run({ parent, task: 'Third task.', domain: 'library', signal: signal() })
  expect(evidenceOf(model.requests[17]!).library).toHaveLength(2)
  await ctx.harness2.run({ parent, task: 'Independent sequential task.', domain: 'library', mode: 'sequential', signal: signal() })
  expect(evidenceOf(model.requests[25]!).library).toEqual([])
})


it('does not checkpoint an invalid selector answer and can retry selection without recomputing candidates', async () => {
  const model = new NativeModel()
  model.selectionChoice = 'base1'
  const { ctx, parent, path } = await bootHarness(model)
  const request = { parent, task: 'Analyze.', domain: 'selection-retry', k: 2, signal: signal() }
  await expect(ctx.harness2.run(request)).rejects.toThrow('unknown final answer id')
  const id = Harness2RunId(String(storedRecords(path, 'runs')[0]!.runId))
  expect(storedRecords(path, 'checkpoints').some(row => row.label === 'select')).toBe(false)
  expect(storedRecords(path, 'previews')).toEqual([])
  expect(model.proposals).toBe(6)
  const calls = model.requests.length
  model.selectionChoice = 'answer-2'
  const result = await ctx.harness2.run({ ...request, resumeRunId: id })
  expect(result.selected).toBe('agg2')
  expect(model.requests).toHaveLength(calls + 2)
  expect(model.proposals).toBe(6)
})

it('rejects persisted preview content changes instead of reusing a mismatched content hash', async () => {
  const model = new NativeModel()
  const { ctx, parent, path } = await bootHarness(model)
  const request = { parent, task: 'Analyze.', domain: 'integrity', signal: signal() }
  const result = await ctx.harness2.run(request)
  const domain = ctx.storageDomain.get('harness2')!
  const stored = storedRecords(path, 'previews')[0]!
  await domain.table('previews').put(result.runId, { ...stored, candidate: { 'systemprompt.md': 'Changed outside execution.' } })
  const calls = model.requests.length
  await expect(ctx.harness2.run({ ...request, resumeRunId: result.runId })).rejects.toThrow('content hash mismatch')
  expect(model.requests).toHaveLength(calls)
})


it('retains failed baseline evidence, continues surviving runs, and excludes a failed final from selection', async () => {
  const model = new NativeModel()
  model.failSolverCalls = new Set([1, 7])
  const { ctx, parent } = await bootHarness(model)
  const result = await ctx.harness2.run({ parent, task: 'Analyze.', domain: 'dead-rollout', k: 2, signal: signal() })
  expect(model.solverCalls).toBe(8)
  expect(model.proposals).toBe(6)
  expect(result.finals).toHaveLength(2)
  expect(result.finals[0]!.error).toBe('Harness² final ended with error')
  expect(result.finals[0]!.answer).toBe('')
  expect(result.selected).toBe('agg2')
  expect(result.answer).toBe(result.finals[1]!.answer)
  const proposals = model.requests.filter(request => JSON.stringify(request.messages).includes('Assignment:\\nPropose'))
  expect(JSON.stringify(proposals)).toContain('Harness² baseline ended with error')
})
