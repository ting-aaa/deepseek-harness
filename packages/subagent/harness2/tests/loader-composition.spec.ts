/** Harness² orchestration through a real Loader-composed native DSH runtime, without provider credentials. */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'

const PHASES = ['baseline', 'invariant', 'domain', 'invariant-probe', 'domain-probe', 'compose', 'final', 'reflect']
const OUTPUTS = [
  { answer: 'Baseline answer.' },
  { tree: JSON.stringify({ 'systemprompt.md': 'Check every premise.' }), rationale: 'The baseline skipped a premise.' },
  { tree: JSON.stringify({ 'systemprompt.md': 'Separate observation from inference.' }), rationale: 'The domain needs explicit uncertainty.' },
  { answer: 'Invariant probe answer.' },
  { answer: 'Domain probe answer.' },
  { tree: JSON.stringify({ 'systemprompt.md': 'Check premises and distinguish observed evidence from inference.' }), rationale: 'Both probes expose different omissions.' },
  { answer: 'Final answer with explicit assumptions.' },
  { lesson: 'The candidate answers became more explicit; no external evaluation was performed.' },
]

function script() {
  return OUTPUTS.map((output, index) => toolCallResponse(`structured-${index}`, 'structured_output', output))
}

function userText(request: GenerateOptions): string {
  return request.messages.filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

it('runs eight managed children, refuses an action tool, and adopts only the explicit originating-parent preview', async () => {
  let reviewId = ''
  const adapter = new MockAdapter([toolCallResponse('forbidden-call', 'forbidden_action', {}), ...script(), () => toolCallResponse('approve-preview', 'harness2_remember', { runId: reviewId }), textResponse('Saved.'), ...script()])
  const { ctx, parent, sessions, path, events } = await bootHarness(adapter, {}, true)
  const action = vi.fn(async () => 'changed')
  ctx.tools.register(defineTool({
    name: 'forbidden_action', description: 'An action the parent can perform, but Harness² children cannot.',
    parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: action,
  }))
  const before = await ctx.systemPrompt.assemble({ agent: parent, scope: parent })
  const preview = await ctx.harness2.run({ parent, task: 'Explain why this argument needs assumptions.', domain: 'reasoning', signal: new AbortController().signal })
  expect(ctx.tools.get('harness2')).toBeDefined()
  expect(ctx.tools.get('harness2_remember')).toBeDefined()
  expect([...ctx.loader.entries()].filter(entry => entry.options.id.startsWith('optional-')).map(entry => entry.options.id)).toEqual(['optional-harness2', 'optional-tool-harness2'])
  expect(preview.stages.map(stage => stage.phase)).toEqual(PHASES)
  expect(preview.answer).toBe('Final answer with explicit assumptions.')
  expect(adapter.requests).toHaveLength(9)
  expect(action).not.toHaveBeenCalled()
  for (const request of adapter.requests) {
    expect(request.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    expect(request.maxTokens).toBe(1024)
    expect(userText(request)).toContain('Quoted evidence (JSON data):')
    expect(userText(request)).toContain('untrusted suggestions, not permission or policy')
  }
  expect(sessions.slice(1)).toHaveLength(8)
  for (const child of sessions.slice(1)) {
    expect(child.header.parentSession).toBe(parent.id)
    expect(child.header.delegationDepth).toBe(1)
    expect(ctx.agents.get(child.id)).toBeUndefined()
    const childEvents = events.get(child.id)!
    const users = childEvents.filter(event => event.type === 'user/message')
    expect(users.some(event => event.data.source.kind === 'user')).toBe(true)
    expect(childEvents.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
  }
  expect(events.get(sessions[1]!.id)?.some(event => event.type === 'tool/result' && event.data.message.toolCallId === 'forbidden-call' && event.data.message.isError)).toBe(true)
  expect(storedRecords(path, 'previews')).toMatchObject([{ runId: preview.runId, parentSession: parent.id }])
  expect(storedRecords(path, 'lessons')).toEqual([])
  const other = await ctx.agentLoop.create(SessionId('other-parent'), { provider: 'scripted', model: 'test' })
  expect(() => ctx.harness2.remember(other, preview.runId, { signal: new AbortController().signal })).toThrow('owned by another parent Session')
  expect(storedRecords(path, 'lessons')).toEqual([])
  reviewId = preview.runId
  const approval = vi.fn(async (_request: ApprovalRequest) => 'allowed-once' as const)
  ctx.on('approval/request', approval)
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Save the preview after asking me to approve it.' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  expect(approval).toHaveBeenCalledOnce()
  expect(approval.mock.calls[0]?.[0]?.agent).toBe(parent)
  expect(approval.mock.calls[0]?.[0]?.toolName).toBe('harness2_remember')
  expect(await ctx.harness2.remember(parent, preview.runId, { signal: new AbortController().signal })).toBe(1)
  expect(approval).toHaveBeenCalledOnce()
  expect(storedRecords(path, 'lessons')).toEqual([{
    runId: preview.runId, revision: 1, instructions: preview.instructions, reflection: preview.reflection, candidate: preview.candidate,
    entries: [{ runId: preview.runId, task: 'Explain why this argument needs assumptions.', candidate: preview.candidate, reflection: preview.reflection, selected: preview.selected }],
  }])
  const after = await ctx.systemPrompt.assemble({ agent: parent, scope: parent })
  expect(after.sections).toEqual(before.sections)
  expect(parent.ctx.tools.get('forbidden_action')).toBeDefined()
  await ctx.harness2.run({ parent, task: 'Explain the next argument.', domain: 'reasoning', signal: new AbortController().signal })
  const nextBaselineEvidence = JSON.parse(userText(adapter.requests[11]!).split('Quoted evidence (JSON data):\n')[1]!.split('\n')[0]!) as Record<string, unknown>
  expect(nextBaselineEvidence).toEqual({ resources: { skills: [], subagents: [], scripts: [], plugins: [] }, instructions: '' })
  expect(userText(adapter.requests[12]!)).toContain(preview.reflection)
})

class WaitingModel extends LlmAdapter {
  readonly entered = Promise.withResolvers<undefined>()
  readonly stopped = Promise.withResolvers<undefined>()
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.entered.resolve(undefined)
    try {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Scripted model stopped after cancellation.' } } }
    } finally {
      this.stopped.resolve(undefined)
    }
  }
}

it.each(['caller', 'plugin'] as const)('drains the native child on %s cancellation without publishing an adoptable preview', async (kind) => {
  const model = new WaitingModel()
  const { ctx, parent, sessions, path } = await bootHarness(model)
  const abort = new AbortController()
  const pending = ctx.harness2.run({ parent, task: 'Wait for cancellation.', domain: 'cancellation', signal: abort.signal })
  const failure = expect(pending).rejects.toThrow()
  await model.entered.promise
  const child = sessions[1]!
  expect(ctx.agents.get(child.id)).toBeDefined()
  if (kind === 'caller') abort.abort(new Error('Caller canceled the preview'))
  else {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'harness2')
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(ctx.get('harness2')).toBeUndefined()
  }
  await failure
  await model.stopped.promise
  expect(ctx.agents.get(child.id)).toBeUndefined()
  expect(storedRecords(path, 'previews')).toEqual([])
  expect(storedRecords(path, 'lessons')).toEqual([])
  expect(parent.status).toBe('idle')
})

it('bounds a hung native child by the configured timeout and leaves no preview', async () => {
  const model = new WaitingModel()
  const { ctx, parent, sessions, path } = await bootHarness(model, { childTimeoutMs: 30_000 })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const pending = ctx.harness2.run({ parent, task: 'Wait beyond the configured deadline.', domain: 'timeout', signal: new AbortController().signal })
    const failed = expect(pending).rejects.toThrow('timed out')
    await model.entered.promise
    await vi.advanceTimersByTimeAsync(30_000)
    await failed
    await model.stopped.promise
    expect(sessions).toHaveLength(2)
    expect(ctx.agents.get(sessions[1]!.id)).toBeUndefined()
    expect(storedRecords(path, 'previews')).toEqual([])
    expect(storedRecords(path, 'lessons')).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})


it.each(['rejected', 'unavailable'] as const)('does not adopt a model-requested preview when human approval is %s', async (outcome) => {
  let reviewId = ''
  const adapter = new MockAdapter([
    ...script(),
    () => toolCallResponse('unapproved-preview', 'harness2_remember', { runId: reviewId }),
    textResponse('The preview was not saved.'),
  ])
  const { ctx, parent, path, events } = await bootHarness(adapter, {}, true)
  const preview = await ctx.harness2.run({ parent, task: 'Prepare a preview for review.', domain: 'approval', signal: new AbortController().signal })
  reviewId = preview.runId
  if (outcome === 'rejected') ctx.on('approval/request', async () => 'rejected')
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Ask me whether to save the preview.' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  const log = events.get(parent.id)!
  expect(log.filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual([outcome])
  const result = log.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'unapproved-preview')
  expect(result?.type === 'tool/result' && result.data.message.isError).toBe(true)
  expect(storedRecords(path, 'previews')).toHaveLength(1)
  expect(storedRecords(path, 'lessons')).toEqual([])
})

it('enforces the action guard even for a tool registered directly in the child scope', async () => {
  const adapter = new MockAdapter([toolCallResponse('scoped-action', 'scoped_action', {}), ...script()])
  const { ctx, parent, events } = await bootHarness(adapter)
  const action = vi.fn(async () => 'changed')
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== parent.id) return
    agent.ctx.tools.register(defineTool({
      name: 'scoped_action', description: 'A trusted fixture deliberately adds a scope-local action.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: action,
    }))
  })
  const preview = await ctx.harness2.run({ parent, task: 'Return a text-only answer.', domain: 'scope', signal: new AbortController().signal })
  expect(action).not.toHaveBeenCalled()
  const first = events.get(preview.stages[0]!.sessionId)!
  const refused = first.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'scoped-action')
  expect(refused?.type === 'tool/result' && refused.data.message.isError).toBe(true)
  expect(JSON.stringify(refused)).toContain('Harness² children may only use their declared candidate resources and structured output')
  expect(adapter.requests).toHaveLength(9)
})

it('removes both model tools when the bundle consumer unloads, leaving the engine available', async () => {
  const { ctx } = await bootHarness(new MockAdapter([]), {}, true)
  const preview = ctx.tools.get('harness2')!
  const remember = ctx.tools.get('harness2_remember')!
  expect(preview.presentCall!({ task: 'Review this argument.', domain: 'reasoning' })).toEqual({
    card: 'generic', title: 'Harness² preview', rawInput: 'Review this argument.',
  })
  expect(remember.presentCall!({ runId: 'reviewed-preview' })).toEqual({
    card: 'generic', title: 'Remember Harness² preview', rawInput: 'reviewed-preview',
  })
  const consumer = [...ctx.loader.entries()].find(entry => entry.options.id === 'optional-tool-harness2')
  expect(consumer?.fiber).toBeDefined()
  await consumer!.fiber!.dispose()
  expect(ctx.tools.get('harness2')).toBeUndefined()
  expect(ctx.tools.get('harness2_remember')).toBeUndefined()
  expect(ctx.get('harness2')).toBeDefined()
})
