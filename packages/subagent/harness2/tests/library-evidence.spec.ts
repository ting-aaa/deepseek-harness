/** Whole-record history budgets use exact serialized child messages and the real Loader/SQLite adoption flow. */
import { expect, it } from 'vitest'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { libraryEvidence } from '../src/library-evidence.ts'
import { childPrompt } from '../src/prompts.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'

it('retains newest complete records under an exact serialized budget, skipping oversized entries without truncation', () => {
  const oldest = Object.freeze({ id: 'old', task: 'old'.repeat(1000) })
  const oversized = Object.freeze({ id: 'oversized', task: '\"\\\n'.repeat(2000) })
  const newest = Object.freeze({ id: 'new', task: 'new task' })
  const library = Object.freeze([oldest, oversized, newest])
  const evidence = { baseline: ['complete current execution evidence'], rejection: 'quoted "evidence"' }
  const expected = { ...evidence, library: [newest], priorReflection: 'complete reflection', libraryOmitted: 2, priorReflectionOmitted: false }
  const limit = childPrompt('current task', 'complete assignment', expected).length
  const result = libraryEvidence('current task', 'complete assignment', evidence, library, 'complete reflection', limit)
  expect(result).toEqual(expected)
  expect(result.library[0]).toBe(newest)
  expect(childPrompt('current task', 'complete assignment', result)).toHaveLength(limit)
  expect(oversized.task).toHaveLength(6000)
  expect(library).toHaveLength(3)
})

it('omits a complete reflection or single experience that cannot fit instead of slicing its text', () => {
  const entry = { task: 'task'.repeat(1000) }
  const base = { library: [], priorReflection: '', libraryOmitted: 1, priorReflectionOmitted: true }
  const limit = childPrompt('task', 'assignment', base).length
  const result = libraryEvidence('task', 'assignment', {}, [entry], 'reflection'.repeat(1000), limit)
  expect(result).toEqual(base)
  expect(entry.task).toHaveLength(4000)
})

it('honors the smallest complete-message budget and fails when even untrimmed current evidence cannot fit', () => {
  const evidence = { current: 'untrimmed current execution' }
  const expected = { ...evidence, library: [], priorReflection: '', libraryOmitted: 0, priorReflectionOmitted: false }
  const limit = childPrompt('task', 'assignment', expected).length
  expect(libraryEvidence('task', 'assignment', evidence, [], '', limit)).toEqual(expected)
  expect(() => libraryEvidence('task', 'assignment', evidence, [], '', limit - 1)).toThrow('current evidence alone exceeds the budget')
  expect(() => libraryEvidence('task', 'assignment', evidence, [], '', 1)).toThrow('at most 1 characters')
})

class LibraryModel extends LlmAdapter {
  pendingAdoption: string | undefined
  private parentReply = false
  readonly requests: GenerateOptions[] = []
  constructor(private readonly reflectionChars: number) { super() }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.pendingAdoption !== undefined) {
      const runId = this.pendingAdoption
      this.pendingAdoption = undefined
      this.parentReply = true
      yield* toolCallResponse('adopt-reviewed', 'harness2_remember', { runId })
      return
    }
    if (this.parentReply) {
      this.parentReply = false
      yield* textResponse('Saved the approved preview.')
      return
    }
    this.requests.push(options)
    const text = taskText(options)
    const output = text.includes('Assignment:\nReflect on') ? { lesson: 'r'.repeat(this.reflectionChars) }
      : text.includes('Assignment:\nProduce the best') ? { answer: 'A.' }
        : { tree: JSON.stringify({ 'systemprompt.md': 'x' }), rationale: 'R.' }
    yield* toolCallResponse('structured', 'structured_output', output)
  }
}

function taskText(options: GenerateOptions): string {
  return options.messages.filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    .find(text => text.includes('Quoted evidence (JSON data):')) ?? ''
}

it.each([
  { limit: 64000, taskChars: 16000, reflectionChars: 8000 },
  { limit: 9000, taskChars: 1500, reflectionChars: 1000 },
])('continues same-domain previews after full valid adoptions with complete-message budget $limit', async ({ limit, taskChars, reflectionChars }) => {
  const model = new LibraryModel(reflectionChars)
  const { ctx, parent, path } = await bootHarness(model, { maxEvidenceChars: limit, maxReflectionChars: reflectionChars }, true)
  ctx.on('approval/request', async () => 'allowed-once')
  for (const [index, task] of ['a'.repeat(taskChars), 'b'.repeat(taskChars), 'c'].entries()) {
    const preview = await ctx.harness2.run({ parent, task, domain: 'history-budget', signal: new AbortController().signal })
    model.pendingAdoption = preview.runId
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'I reviewed this preview; save it.' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(storedRecords(path, 'lessons')[0]?.revision).toBe(index + 1)
  }
  const stored = storedRecords(path, 'lessons')[0]!
  const before = model.requests.length
  const preview = await ctx.harness2.run({ parent, task: 'd', domain: 'history-budget', signal: new AbortController().signal })
  expect(preview.answer).toBe('A.')
  const requests = model.requests.slice(before)
  expect(requests).toHaveLength(8)
  expect(requests.every(request => taskText(request).length <= limit)).toBe(true)
  const improvements = requests.filter(request => taskText(request).includes('Return tree as a JSON-encoded object'))
  const evidence = improvements.map(request => JSON.parse(taskText(request).split('Quoted evidence (JSON data):\n')[1]!) as {
    library: object[]
    libraryOmitted: number
    priorReflection: string
    priorReflectionOmitted: boolean
  })
  expect(evidence.some(item => item.libraryOmitted > 0)).toBe(true)
  const entries = stored.entries as object[]
  expect(entries).toHaveLength(3)
  for (const item of evidence) for (const entry of item.library) expect(entries).toContainEqual(entry)
  expect(storedRecords(path, 'lessons')[0]).toEqual(stored)
})
