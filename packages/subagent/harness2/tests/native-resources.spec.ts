/** Candidate resources through real child Agents, tools, events and disposal. */
import { expect, it } from 'vitest'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootHarness } from './loader-harness.ts'

it.each([['skill', 2], ['delegate', 2], ['delegate', 1]] as const)('executes scoped candidate %s resources within maxDepth=%s and disposes their owners', async (kind, maxDepth) => {
  const path = kind === 'skill' ? 'skills/checker/SKILL.md' : 'sub_agents/checker/AGENT.md'
  const body = kind === 'skill'
    ? '---\nname: checker\ndescription: Check evidence\n---\nInspect every premise before concluding.'
    : '---\nmode: subagent\ndescription: Check evidence\n---\nInspect every premise before concluding.'
  const tree = { 'systemprompt.md': 'Consult checker before answering.', [path]: body }
  const tool = kind === 'skill' ? 'harness2_skill' : 'harness2_delegate'
  class ResourceModel extends LlmAdapter {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const text = JSON.stringify(options.messages)
      const mission = options.messages.filter(message => message.role === 'user').flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
      if (mission.includes('Assignment:\nReflect on')) {
        yield* toolCallResponse('structured', 'structured_output', { lesson: 'Observed tool evidence, not external grading.' })
      } else if (!mission.includes('Assignment:\nProduce the best')) {
        yield* toolCallResponse('structured', 'structured_output', { tree: JSON.stringify(tree), rationale: 'Keep the checked workflow.' })
      } else if (options.tools?.some(item => item.name === tool) && !options.messages.some(message => message.role === 'tool')) {
        yield* toolCallResponse('read-resource', tool, { path, ...kind === 'delegate' ? { task: 'Check the premise.' } : {} })
      } else {
        yield* toolCallResponse('structured', 'structured_output', { answer: text.includes('subagent') ? 'Checked delegated premise.' : 'Checked supplied premise.' })
      }
    }
  }
  const { ctx, parent, sessions, events } = await bootHarness(new ResourceModel(), { baseCandidate: tree }, false, { maxDepth })
  const result = await ctx.harness2.run({ parent, task: 'Check this premise.', domain: 'resources', signal: new AbortController().signal })
  expect(result.candidate).toEqual(tree)
  expect(result.finals[0]!.trajectory).toContain('read-resource')
  expect(result.finals[0]!.trajectory).toContain(tool)
  expect(ctx.tools.get(tool)).toBeUndefined()
  const calls = [...events.values()].flat().filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'read-resource')
  expect(calls).toHaveLength(4)
  for (const event of calls) {
    if (event.type !== 'tool/result') throw new Error('Expected a tool result')
    const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    const denied = kind === 'delegate' && maxDepth === 1
    expect(event.data.message.isError, text).toBe(denied)
    expect(text).toContain(denied ? 'depth 2 exceeds maxDepth 1' : kind === 'skill' ? body : 'Checked delegated premise.')
  }
  if (kind === 'delegate' && maxDepth === 2) {
    expect(sessions.filter(session => session.header.delegationDepth === 2)).toHaveLength(4)
    expect(result.stages).toHaveLength(12)
  } else {
    expect(sessions).toHaveLength(9)
  }
  for (const child of sessions.slice(1)) expect(ctx.agents.get(child.id)).toBeUndefined()
})
