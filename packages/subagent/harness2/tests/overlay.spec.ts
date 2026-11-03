/** Workspace binding: adopted revisions reach later ordinary Agents, never the running conversation. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { overlaySkills, overlayText, workspaceRoot } from '../src/overlay.ts'
import { librarySpec } from '../src/records.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'

const SKILL = '---\nname: ledger-check\ndescription: Reconcile ledger totals\n---\nSum each column and compare.'
const AGENT = '---\nmode: subagent\ndescription: Reads one ledger\n---\nDELEGATE-MARKER Summarize the ledger.'

function candidate(version: number, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'systemprompt.md': `Version ${version}: always reconcile figures. When reconciling ledgers, load the ledger-check skill.`,
    'skills/ledger-check/SKILL.md': SKILL,
    'sub_agents/reader/AGENT.md': AGENT,
    ...extra,
  }
}

class OverlayModel extends LlmAdapter {
  version = 1
  extra: Record<string, string> = {}
  readonly queue: { name: string; args: Record<string, unknown> }[] = []
  readonly results: string[] = []
  private reply = false
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const content = options.messages.filter(message => message.role === 'user').flatMap(message =>
      message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    if (content.includes('This is a bounded Harness² experiment')) {
      let output: object
      if (content.includes('Assignment:\nReflect on')) output = { lesson: 'Reconcile before writing.' }
      else if (content.includes('Assignment:\nProduce the best')) output = { answer: 'Reconciled.' }
      else output = { tree: JSON.stringify(candidate(this.version, this.extra)), rationale: 'Observed omissions.' }
      yield* toolCallResponse('structured', 'structured_output', output)
      return
    }
    if (content.includes('DELEGATE-MARKER')) {
      yield* toolCallResponse('structured', 'structured_output', { answer: 'Ledger summarized.' })
      return
    }
    const last = options.messages.at(-1)
    if (last?.role === 'tool') {
      this.results.push(last.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
    }
    if (this.reply) {
      this.reply = false
      yield* textResponse('Done.')
      return
    }
    const call = this.queue.shift()
    if (call === undefined) {
      yield* textResponse('Idle.')
      return
    }
    this.reply = true
    yield* toolCallResponse(`call-${call.name}`, call.name, call.args)
  }
}

const signal = () => new AbortController().signal

async function drive(agent: Agent, model: OverlayModel, name: string, args: Record<string, unknown>): Promise<string> {
  model.queue.push({ name, args })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: `Please ${name}.` }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return model.results.at(-1) ?? ''
}

async function prompt(ctx: Awaited<ReturnType<typeof bootHarness>>['ctx'], agent: Agent): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
}

describe('overlay helpers', () => {
  it('resolves the nearest Git root, otherwise the directory itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness2-workspace-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, 'repo', '.git'), { recursive: true })
    await mkdir(join(root, 'repo', 'src', 'deep'), { recursive: true })
    expect(workspaceRoot(join(root, 'repo', 'src', 'deep'))).toBe(join(root, 'repo'))
    expect(workspaceRoot(join(root, 'plain'))).toBe(join(root, 'plain'))
  })

  it('parses skills and tolerates malformed frontmatter', () => {
    expect(overlaySkills(candidate(1))).toEqual([{ name: 'ledger-check', description: 'Reconcile ledger totals', content: 'Sum each column and compare.' }])
    expect(overlaySkills({ 'systemprompt.md': '', 'skills/bare/SKILL.md': 'No frontmatter.' }))
      .toEqual([{ name: 'bare', description: 'skills/bare/SKILL.md', content: 'No frontmatter.' }])
    expect(overlaySkills({ 'systemprompt.md': '', 'skills/odd/SKILL.md': '---\nname: odd\n---\nBody' }))
      .toEqual([{ name: 'odd', description: 'skills/odd/SKILL.md', content: 'Body' }])
  })

  it('frames guidance as lower trust and lists resources', () => {
    const binding = { workspace: '/w', domain: 'ledger', mode: 'parallel' as const, revision: 2, boundAt: 0 }
    expect(overlayText(binding, { 'systemprompt.md': '' }, [])).toBe('')
    const text = overlayText(binding, candidate(1, { 'scripts/check.py': 'print(1)' }), ['plugin/guard.ts'])
    expect(text).toContain('lower-trust advice')
    expect(text).toContain('Version 1')
    expect(text).toContain('ledger-check')
    expect(text).toContain('harness2_delegate): sub_agents/reader/AGENT.md')
    expect(text).toContain('harness2_script; each run needs approval): scripts/check.py')
    expect(text).toContain('Unavailable in this deployment: plugin/guard.ts')
    expect(overlayText(binding, { 'systemprompt.md': '' }, ['scripts/x.py'])).toContain('Unavailable')
  })
})

it('remembers, activates, rolls back, and deactivates workspace guidance for new Agents only', async () => {
  const model = new OverlayModel()
  const { ctx, parent, root, path, events } = await bootHarness(model, {}, true)
  ctx.on('approval/request', async () => 'allowed-once')
  const first = await ctx.harness2.run({ parent, task: 'Reconcile Q1.', domain: 'ledger', signal: signal() })
  await drive(parent, model, 'harness2_remember', { runId: first.runId })
  model.version = 2
  const second = await ctx.harness2.run({ parent, task: 'Reconcile Q2.', domain: 'ledger', signal: signal() })
  await drive(parent, model, 'harness2_remember', { runId: second.runId })
  expect(storedRecords(path, 'revisions').map(row => row.revision)).toEqual([1, 2])

  expect(await drive(parent, model, 'harness2_activate', { domain: 'ledger' })).toContain('"revision":2')
  expect(storedRecords(path, 'bindings')).toMatchObject([{ workspace: root, domain: 'ledger', mode: 'parallel', revision: 2 }])
  expect(await prompt(ctx, parent)).not.toContain('Adopted Harness² guidance')

  const bound = await ctx.agentLoop.create(SessionId('bound-agent'), { provider: 'scripted', model: 'test', maxTokens: 1024 }, { cwd: root })
  await bound.whenIdle()
  expect(await prompt(ctx, bound)).toContain('Version 2: always reconcile figures.')
  expect((await ctx.skills.list({ scope: bound, cwd: root })).map(skill => skill.name)).toContain('ledger-check')
  expect(events.get(bound.id)?.find(event => event.type === 'harness2/overlay')?.data).toMatchObject({ domain: 'ledger', revision: 2 })
  const recorded = events.get(bound.id)!.find(event => event.type === 'harness2/overlay')!
  expect({ type: recorded.type, data: { ...recorded.data, workspace: '<workspace>' } }).toMatchSnapshot('adopted revision session record')
  expect(await drive(bound, model, 'harness2_delegate', { path: 'sub_agents/reader/AGENT.md', task: 'Read the Q2 ledger.' })).toContain('Ledger summarized.')

  const status = await drive(parent, model, 'harness2_status', { domain: 'ledger' })
  expect(status).toContain('"revisions"')
  expect(ctx.harness2.status(parent).revisions.map(item => item.revision)).toEqual([1, 2])
  expect(ctx.harness2.status(parent, 'other').revisions).toEqual([])

  await drive(parent, model, 'harness2_activate', { domain: 'ledger', revision: 1, mode: 'parallel' })
  const rolledBack = await ctx.agentLoop.create(SessionId('rolled-back-agent'), { provider: 'scripted', model: 'test' }, { cwd: root })
  expect(await prompt(ctx, rolledBack)).toContain('Version 1: always reconcile figures.')

  expect(await drive(parent, model, 'harness2_deactivate', {})).toContain('"removed":true')
  expect(await ctx.harness2.deactivate(parent)).toBe(false)
  expect(ctx.harness2.status(parent).binding).toBeUndefined()
  const unbound = await ctx.agentLoop.create(SessionId('unbound-agent'), { provider: 'scripted', model: 'test' }, { cwd: root })
  expect(await prompt(ctx, unbound)).not.toContain('Adopted Harness² guidance')
  expect(await prompt(ctx, rolledBack)).toContain('Version 1: always reconcile figures.')
})

it('fails closed without approval or revision and tolerates stale bindings and version 2 libraries', async () => {
  const model = new OverlayModel()
  const { ctx, parent, root, path } = await bootHarness(model, { runtime: null }, true)
  let answer: 'allowed-once' | 'rejected' = 'allowed-once'
  ctx.on('approval/request', async () => answer)
  const run = await ctx.harness2.run({ parent, task: 'Reconcile.', domain: 'ledger', signal: signal() })
  await drive(parent, model, 'harness2_remember', { runId: run.runId })
  await expect(ctx.harness2.activate(parent, { domain: 'missing' }, { signal: signal() })).rejects.toThrow('no adopted parallel revision (latest)')
  await expect(ctx.harness2.activate(parent, { domain: 'ledger', revision: 7 }, { signal: signal() })).rejects.toThrow('revision 7')
  answer = 'rejected'
  expect(await drive(parent, model, 'harness2_activate', { domain: 'ledger' })).toContain('not approved')
  expect(storedRecords(path, 'bindings')).toEqual([])
  answer = 'allowed-once'

  // A library written before revision history still binds its current lesson.
  const domain = ctx.storageDomain.get('harness2')!
  const lesson = librarySpec.tables.lessons.valueSchema.parse(domain.table('lessons').get('parallel:ledger'))
  await domain.table('lessons').put('parallel:ledger', { ...lesson,
    candidate: { ...lesson.candidate, 'scripts/check.py': 'print(1)' },
  })
  await domain.table('revisions').deleteMany([...domain.table('revisions').keys()])
  await drive(parent, model, 'harness2_activate', { domain: 'ledger' })
  const bound = await ctx.agentLoop.create(SessionId('runtime-less-agent'), { provider: 'scripted', model: 'test' }, { cwd: root })
  const text = await prompt(ctx, bound)
  expect(text).toContain('Unavailable in this deployment: scripts/check.py')

  await domain.table('bindings').put(root, { workspace: root, domain: 'ledger', mode: 'parallel', revision: 9, boundAt: 0 })
  const stale = await ctx.agentLoop.create(SessionId('stale-agent'), { provider: 'scripted', model: 'test' }, { cwd: root })
  expect(await prompt(ctx, stale)).not.toContain('Adopted Harness² guidance')

  await domain.table('revisions').put('parallel:ledger:9', { domain: 'ledger', mode: 'parallel', revision: 9, runId: 'invalid',
    candidate: { 'notes.txt': 'unsupported' }, instructions: '', reflection: '', adoptedAt: 0 })
  const invalid = await ctx.agentLoop.create(SessionId('invalid-agent'), { provider: 'scripted', model: 'test' }, { cwd: root })
  expect(await prompt(ctx, invalid)).not.toContain('Adopted Harness² guidance')
})

it('pins active and inactive overlay decisions across persistence resume', async () => {
  const model = new OverlayModel()
  const { ctx, parent, root } = await bootHarness(model, {}, true)
  ctx.on('approval/request', async () => 'allowed-once')
  const inactive = await ctx.agents.create({ sessionId: SessionId('inactive-resume'), meta: { cwd: root } })
  await inactive.dispose()
  const run = await ctx.harness2.run({ parent, task: 'Reconcile.', domain: 'ledger', signal: signal() })
  await drive(parent, model, 'harness2_remember', { runId: run.runId })
  await drive(parent, model, 'harness2_activate', { domain: 'ledger' })
  const active = await ctx.agents.create({ sessionId: SessionId('active-resume'), meta: { cwd: root } })
  expect(await prompt(ctx, active.agent)).toContain('Version 1:')
  await active.dispose()
  await ctx.harness2.deactivate(parent)
  const resumed = await ctx.agents.resume({ resumeSessionId: SessionId('active-resume') })
  expect(await prompt(ctx, resumed.agent)).toContain('Version 1:')
  await resumed.dispose()
  await drive(parent, model, 'harness2_activate', { domain: 'ledger' })
  const stillInactive = await ctx.agents.resume({ resumeSessionId: SessionId('inactive-resume') })
  expect(await prompt(ctx, stillInactive.agent)).not.toContain('Adopted Harness² guidance')
  await stillInactive.dispose()
  const domain = ctx.storageDomain.get('harness2')!
  const accepted = librarySpec.tables.revisions.valueSchema.parse(domain.table('revisions').get('parallel:ledger:1'))
  await domain.table('revisions').put('parallel:ledger:1', { ...accepted, candidate: { 'systemprompt.md': 'Tampered.' } })
  await expect(ctx.agents.resume({ resumeSessionId: SessionId('active-resume') })).rejects.toThrow('hash mismatch')
})
