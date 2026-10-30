/** Native read-only task capabilities run through the real Loader and filesystem tool; all mutable state is fixture-owned. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootHarness } from './loader-harness.ts'

function stages() {
  return [
    { answer: 'Observed the supplied file.' },
    { tree: JSON.stringify({ 'systemprompt.md': 'Inspect the supplied source.' }), rationale: 'Use observed source.' },
    { tree: JSON.stringify({ 'systemprompt.md': 'Separate proposals from applied changes.' }), rationale: 'Keep effects explicit.' },
    { answer: 'Invariant probe.' }, { answer: 'Domain probe.' },
    { tree: JSON.stringify({ 'systemprompt.md': 'Inspect source and return proposed changes.' }), rationale: 'Use both observations.' },
    { answer: 'Selected proposal; the parent applies it.' }, { lesson: 'Observed source supports the proposal.' },
  ].map((value, index) => toolCallResponse(`structured-${index}`, 'structured_output', value))
}

it('reads actual task files while speculative write, shell and proposal-tool calls cannot apply changes', async () => {
  const responses = stages()
  const adapter = new MockAdapter([
    toolCallResponse('read-input', 'read', { file_path: 'input.txt' }),
    toolCallResponse('write-attempt', 'write', { file_path: 'input.txt', content: 'unsafe overwrite' }),
    toolCallResponse('shell-attempt', 'bash', {}),
    ...responses.slice(0, 1),
    toolCallResponse('proposal-read-attempt', 'read', { file_path: 'input.txt' }),
    ...responses.slice(1),
    toolCallResponse('parent-apply', 'write', { file_path: 'input.txt', content: 'APPLIED_ONCE_BY_PARENT\n' }),
    textResponse('Applied the selected change.'),
  ])
  const { ctx, parent, root, events } = await bootHarness(adapter, { maxStepsPerChild: 5 }, true, {}, true)
  await writeFile(join(root, 'input.txt'), 'ACTUAL_TASK_SOURCE_42\n')
  const shell = vi.fn(async () => 'must not run')
  ctx.tools.register(defineTool({ name: 'bash', description: 'A fixture shell capability.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute: shell }))
  const result = await ctx.harness2.run({ parent, task: 'Inspect input.txt and propose a correction without applying it.', domain: 'files', signal: new AbortController().signal })
  expect(result.answer).toBe('Selected proposal; the parent applies it.')
  const baseline = events.get(result.stages[0]!.sessionId)!
  const read = baseline.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'read-input')
  expect(read?.type === 'tool/result' && read.data.message.isError).toBe(false)
  expect(JSON.stringify(read)).toContain('ACTUAL_TASK_SOURCE_42')
  expect(baseline.some(event => event.type === 'tool/result' && event.data.message.toolCallId === 'write-attempt' && event.data.message.isError)).toBe(true)
  expect(baseline.some(event => event.type === 'tool/result' && event.data.message.toolCallId === 'shell-attempt' && event.data.message.isError)).toBe(true)
  const proposal = events.get(result.stages.find(stage => stage.phase === 'invariant')!.sessionId)!
  expect(proposal.some(event => event.type === 'tool/result' && event.data.message.toolCallId === 'proposal-read-attempt' && event.data.message.isError)).toBe(true)
  expect(adapter.requests[0]?.tools?.map(tool => tool.name).sort()).toEqual(['read', 'structured_output'])
  expect(adapter.requests.every(request => !request.tools?.some(tool => tool.name === 'bash' || tool.name === 'write' || tool.name === 'edit'))).toBe(true)
  expect(shell).not.toHaveBeenCalled()
  expect(await readFile(join(root, 'input.txt'), 'utf8')).toBe('ACTUAL_TASK_SOURCE_42\n')
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Apply the selected change to input.txt once.' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  expect(await readFile(join(root, 'input.txt'), 'utf8')).toBe('APPLIED_ONCE_BY_PARENT\n')
  expect(events.get(parent.id)?.filter(event => event.type === 'tool/call' && event.data.name === 'write')).toHaveLength(1)
})

it.each(['restriction', 'guard', 'replacement'] as const)('honors the initiating parent %s during actual child dispatch', async (kind) => {
  let change = () => {}
  const adapter = new MockAdapter([
    () => { change(); return toolCallResponse('revoked-read', 'read', { file_path: 'input.txt' }) },
    ...stages(),
  ])
  const { ctx, parent, root, events } = await bootHarness(adapter, {}, false, {}, true)
  await writeFile(join(root, 'input.txt'), 'DO_NOT_DISCLOSE_AFTER_REVOCATION\n')
  const replacement = vi.fn(async () => ({ path: 'replacement', offset: 1, lines: [], totalLines: 0 }))
  if (kind === 'restriction') change = () => { parent.ctx.tools.restrict({ deny: ['read'] }) }
  else if (kind === 'guard') change = () => { parent.ctx.tools.guard(exec => exec.name === 'read' ? 'Parent forbids this exact read.' : undefined) }
  else change = () => {
    const original = ctx.tools.get('read', parent)!
    parent.ctx.tools.register({ ...original, execute: replacement })
  }
  const result = await ctx.harness2.run({ parent, task: 'Inspect input.txt.', domain: kind, signal: new AbortController().signal })
  const baseline = events.get(result.stages[0]!.sessionId)!
  const refused = baseline.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'revoked-read')
  expect(refused?.type === 'tool/result' && refused.data.message.isError).toBe(true)
  expect(JSON.stringify(refused)).not.toContain('DO_NOT_DISCLOSE_AFTER_REVOCATION')
  expect(replacement).not.toHaveBeenCalled()
})

it.each(['parent', 'deployment'] as const)('does not admit a tool excluded by %s restrictions', async (owner) => {
  const adapter = new MockAdapter([toolCallResponse('not-admitted', 'read', { file_path: 'input.txt' }), ...stages()])
  const { ctx, parent, root, events } = await bootHarness(adapter, owner === 'deployment' ? { readTools: [] } : {}, false, {}, true)
  await writeFile(join(root, 'input.txt'), 'NOT_ADMITTED\n')
  if (owner === 'parent') parent.ctx.tools.restrict({ deny: ['read'] })
  const result = await ctx.harness2.run({ parent, task: 'Inspect input.txt.', domain: 'denied', signal: new AbortController().signal })
  expect(adapter.requests.every(request => request.tools?.map(tool => tool.name).join(',') === 'structured_output')).toBe(true)
  expect(events.get(result.stages[0]!.sessionId)?.some(event => event.type === 'tool/result' && event.data.message.toolCallId === 'not-admitted' && event.data.message.isError)).toBe(true)
})
