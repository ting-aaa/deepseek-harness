/** Real workspace copies, sandboxed file tools, approval and selected-patch application. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootHarness, storedRecords } from './loader-harness.ts'
import { WorkspaceGit, RolloutWorkspace } from '../src/workspace.ts'
import { librarySpec } from '../src/records.ts'

class WorkspaceModel extends LlmAdapter {
  readonly calls: { name: string; args: object }[] = []
  original = ''
  shell = false
  readonly requests: GenerateOptions[] = []
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = options.messages.filter(message => message.role === 'user').flatMap(message =>
      message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    if (text.includes('Read context/task.md for the task and context/evidence.json')) {
      if (text.includes('You are reading the complete record')) {
        yield* toolCallResponse('experience', 'structured_output', {
          cue: 'Coding tasks with a required check', lesson: 'Keep the check before delivery',
          evidence: 'All final rollouts delivered the expected file', edits: '[]',
        })
      } else if (text.includes('You are choosing which')) {
        yield* toolCallResponse('select', 'structured_output', { choice: 'answer-1', rationale: 'Delivered the requested patch.' })
      } else {
        const seen = (id: string) => options.messages.some(message => message.role === 'tool' && message.toolCallId === id)
        if (!seen('inspect-host')) yield* toolCallResponse('inspect-host', 'read', { file_path: 'context/agent/systemprompt.md' })
        else if (!seen('edit-evidence')) yield* toolCallResponse('edit-evidence', 'write', { file_path: 'context/task.md', content: 'CORRUPTED' })
        else if (!seen('edit-harness')) yield* toolCallResponse('edit-harness', 'write', {
          file_path: 'context/harness/systemprompt.md', content: 'Run the required check before delivery.',
        })
        else yield* toolCallResponse('proposal-notes', 'structured_output', { notes: 'The deliverables support keeping the check.' })
      }
      return
    }
    if (text.includes('Assignment:\nComplete the task')) {
      const seen = (id: string) => options.messages.some(message => message.role === 'tool' && message.toolCallId === id)
      if (!seen('read-source')) yield* toolCallResponse('read-source', 'read', { file_path: 'input.txt' })
      else if (this.shell && !seen('shell-copy')) yield* toolCallResponse('shell-copy', 'pwsh', {
        command: '[IO.File]::WriteAllText((Join-Path (Get-Location) "shell.txt"), "SHELL")', description: 'Create the private shell deliverable',
      })
      else if (!seen('escape-copy')) yield* toolCallResponse('escape-copy', 'write', { file_path: this.original, content: 'ESCAPED' })
      else if (!seen('write-copy')) yield* toolCallResponse('write-copy', 'write', { file_path: 'answer.txt', content: 'FIXED\n' })
      else yield* toolCallResponse('answer', 'structured_output', { answer: 'Completed in copy.' })
      return
    }
    if (text.includes('Assignment:\nProduce the best')) {
      yield* toolCallResponse('answer', 'structured_output', { answer: 'Read-only fallback.' })
      return
    }
    if (text.includes('Assignment:\nReflect on')) {
      yield* toolCallResponse('reflection', 'structured_output', { lesson: 'Only the copied workspace changed.' })
      return
    }
    if (text.includes('Assignment:\nPropose') || text.includes('Assignment:\nCompare the shared')) {
      yield* toolCallResponse('proposal', 'structured_output', { tree: '{"systemprompt.md":""}', rationale: 'Keep the baseline.' })
      return
    }
    if (options.messages.at(-1)?.role === 'tool') {
      yield* textResponse('Done.')
      return
    }
    const call = this.calls.shift()
    if (call === undefined) yield* textResponse('Idle.')
    else yield* toolCallResponse(call.name, call.name, call.args)
  }
}

async function drive(parent: Awaited<ReturnType<typeof bootHarness>>['parent'], model: WorkspaceModel, name: string, args: object) {
  model.calls.push({ name, args })
  parent.followup(createUserMessage({ content: [{ type: 'text', text: `Run ${name}.` }], source: { kind: 'user' } }))
  await parent.whenIdle()
}

it('runs sandboxed write tools in independent dirty-workspace copies and applies only the approved selected patch', async () => {
  // Keep the original outside the sandbox's shared OS-temp write grant.
  const source = await mkdtemp(join(homedir(), '.dsh-harness2-source-'))
  onTestFinished(() => rm(source, { recursive: true, force: true }))
  const model = new WorkspaceModel()
  model.original = join(source, 'input.txt')
  const { ctx, parent, path, root, events } = await bootHarness(model, { rollout: 'workspace', maxStepsPerChild: 8 }, true, {}, true, true)
  await ctx.workingDirectory.set(parent, source)
  let approval: 'allowed-once' | 'rejected' = 'allowed-once'
  let revoke = false
  ctx.on('approval/request', async ({ toolName }) => {
    if (revoke && toolName === 'harness2_apply') parent.session.append('sandbox/mode', { mode: 'read-only' })
    return approval
  })
  const limits = { directory: join(root, 'scratch'), maxBytes: 1024 * 1024, maxFiles: 100, maxDiffBytes: 65536, timeoutMs: 30000 }
  const git = new WorkspaceGit(ctx.subprocess, await ctx.subprocess.resolveExecutable('git'), limits)
  const signal = new AbortController().signal
  await git.checked(source, ['init', '--quiet'], signal)
  await writeFile(model.original, 'COMMITTED\n')
  await git.checked(source, ['add', 'input.txt'], signal)
  const tree = (await git.checked(source, ['write-tree'], signal)).trim()
  const commit = (await git.checked(source, ['commit-tree', tree], signal, 'source\n')).trim()
  await git.checked(source, ['update-ref', 'HEAD', commit], signal)
  await writeFile(model.original, 'DIRTY\n')
  await writeFile(join(source, 'untracked.txt'), 'UNTRACKED\n')
  const before = await git.checked(source, ['status', '--porcelain'], signal)
  await drive(parent, model, 'harness2', { task: 'Fix the example.', domain: 'coding' })
  const preview = librarySpec.tables.previews.valueSchema.parse(storedRecords(path, 'previews')[0])
  expect(preview.executor).toBe('workspace')
  expect(preview.workspace).toBe(source)
  expect(await readFile(model.original, 'utf8')).toBe('DIRTY\n')
  expect(await git.checked(source, ['status', '--porcelain'], signal)).toBe(before)
  const rollouts = preview.stages.filter(stage => ['baseline', 'invariant-probe', 'domain-probe', 'final'].includes(stage.phase))
  const directories = rollouts.map(stage => events.get(stage.sessionId as typeof parent.id)?.find(event => event.type === 'sandbox/mode'))
  expect(directories).toHaveLength(4)
  expect(directories.every(event => event?.type === 'sandbox/mode' && event.data.mode === 'workspace-write')).toBe(true)
  const childResults = [...events.values()].flat().filter(event => event.type === 'tool/result')
  for (const event of childResults) {
    if (event.type === 'tool/result' && event.data.message.toolCallId === 'write-copy') {
      expect(event.data.message.isError, JSON.stringify(event.data.message.content)).not.toBe(true)
    }
  }
  expect(childResults.filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'escape-copy')
    .every(event => event.type === 'tool/result' && event.data.message.isError)).toBe(true)
  expect(JSON.stringify(childResults)).toContain('DIRTY')
  expect(preview.finals[0]?.changes).toContain('+FIXED')
  expect(preview.usage).toEqual({ inputTokens: 200, outputTokens: 100 })
  approval = 'rejected'
  await drive(parent, model, 'harness2_apply', { runId: preview.runId })
  await expect(readFile(join(source, 'answer.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  approval = 'allowed-once'
  revoke = true
  await drive(parent, model, 'harness2_apply', { runId: preview.runId })
  await expect(readFile(join(source, 'answer.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  revoke = false
  parent.session.append('sandbox/mode', { mode: 'danger-full-access' })
  await drive(parent, model, 'harness2_apply', { runId: preview.runId })
  expect(await readFile(join(source, 'answer.txt'), 'utf8')).toBe('FIXED\n')
})

it('reports read-only execution when the host lacks confining providers', async () => {
  const model = new WorkspaceModel()
  const { ctx, parent } = await bootHarness(model, { rollout: 'workspace' })
  const result = await ctx.harness2.run({ parent, task: 'Inspect the example.', domain: 'fallback', signal: new AbortController().signal })
  expect(result.executor).toBe('read-only')
  expect(result.executorReason).toContain('sandbox-enforcing')
  await expect(ctx.harness2.applyChanges(parent, result.runId, { signal: new AbortController().signal }))
    .rejects.toThrow('workspace preview')
})

it('refuses workspace rollouts whose original files fall under the shared OS temporary write grant', async () => {
  const model = new WorkspaceModel()
  const { ctx, parent } = await bootHarness(model, { rollout: 'workspace' }, false, {}, false, true)
  const result = await ctx.harness2.run({ parent, task: 'Inspect the example.', domain: 'shared-temp', signal: new AbortController().signal })
  expect(result.executor).toBe('read-only')
  expect(result.executorReason).toContain('shared OS temporary grant')
})

it('stops a rollout whose provider-reported tokens exceed the configured total', async () => {
  const model = new WorkspaceModel()
  const { ctx, parent, sessions } = await bootHarness(model, { maxRolloutTokens: 1 })
  await expect(ctx.harness2.run({ parent, task: 'Inspect the example.', domain: 'token-limit', signal: new AbortController().signal }))
    .rejects.toThrow('maxRolloutTokens')
  expect(sessions).toHaveLength(2)
  expect(ctx.agents.get(sessions[1]!.id)).toBeUndefined()
})

it('uses upstream file editing with the real host prompt, protects evidence, and remembers structured experience', async () => {
  const source = await mkdtemp(join(homedir(), '.dsh-harness2-editor-'))
  onTestFinished(() => rm(source, { recursive: true, force: true }))
  const model = new WorkspaceModel()
  model.original = join(source, 'input.txt')
  await writeFile(model.original, 'EDITOR_SOURCE\n')
  const { ctx, parent, path, events } = await bootHarness(model, { rollout: 'workspace', editor: 'filesystem',
    maxStepsPerChild: 8 }, true, {}, true, true)
  await ctx.workingDirectory.set(parent, source)
  parent.ctx.systemPrompt.section({ name: 'test:real-prompt', order: 9500, text: 'HOST-BASELINE-MARKER' })
  ctx.on('approval/request', async () => 'allowed-once')
  await drive(parent, model, 'harness2', { task: 'Fix the example with a check.', domain: 'coding', k: 2 })
  const preview = librarySpec.tables.previews.valueSchema.parse(storedRecords(path, 'previews')[0])
  expect(preview.editor).toBe('filesystem')
  expect(preview.candidate['systemprompt.md']).toBe('Run the required check before delivery.')
  expect(preview.lesson).toMatchObject({ cue: 'Coding tasks with a required check', evidence: 'All final rollouts delivered the expected file' })
  const outputs = [...events.values()].flat().filter(event => event.type === 'tool/result')
  const attempts = outputs.filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'edit-evidence')
  expect(attempts).toHaveLength(6)
  expect(attempts.every(event => event.type === 'tool/result' && event.data.message.isError)).toBe(true)
  const promptReads = outputs.filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'inspect-host')
  expect(JSON.stringify(promptReads)).toContain('HOST-BASELINE-MARKER')
  const authorRequests = model.requests.filter(request => JSON.stringify(request.messages).includes('Read context/task.md'))
  expect(authorRequests.length).toBeGreaterThan(6)
  expect(authorRequests.every(request => !request.tools?.some(tool => tool.name === 'bash' || tool.name === 'pwsh'))).toBe(true)
  await drive(parent, model, 'harness2_remember', { runId: preview.runId })
  expect(storedRecords(path, 'lessons')[0]).toMatchObject({ entries: [{ cue: preview.lesson?.cue, evidence: preview.lesson?.evidence }] })
  expect(await readFile(model.original, 'utf8')).toBe('EDITOR_SOURCE\n')
})

it.runIf(process.platform === 'win32')('runs the native Windows PowerShell sandbox in rollout copies', async () => {
  const source = await mkdtemp(join(homedir(), '.dsh-harness2-pwsh-'))
  onTestFinished(() => rm(source, { recursive: true, force: true }))
  const model = new WorkspaceModel()
  model.shell = true
  model.original = join(source, 'input.txt')
  await writeFile(model.original, 'SOURCE\n')
  const { ctx, parent, path, events } = await bootHarness(model, { rollout: 'workspace', maxStepsPerChild: 8 }, true, {}, true, 'shell')
  await ctx.workingDirectory.set(parent, source)
  ctx.on('approval/request', async () => 'allowed-once')
  await drive(parent, model, 'harness2', { task: 'Create the shell deliverable.', domain: 'native-shell' })
  const preview = librarySpec.tables.previews.valueSchema.parse(storedRecords(path, 'previews')[0])
  expect(preview.executor).toBe('workspace')
  const calls = [...events.values()].flat().filter(event => event.type === 'tool/result' && event.data.message.toolCallId === 'shell-copy')
  expect(calls).toHaveLength(4)
  for (const event of calls) {
    if (event.type === 'tool/result') expect(event.data.message.isError, JSON.stringify(event.data.message.content)).not.toBe(true)
  }
  expect(preview.finals[0]?.changes).toContain('+SHELL')
  await expect(readFile(join(source, 'shell.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('copies untracked files and rejects bounds without mutating the original', async () => {
  const model = new WorkspaceModel()
  const { ctx, root } = await bootHarness(model, {}, false, {}, false, true)
  const source = await mkdtemp(join(homedir(), '.dsh-harness2-snapshot-'))
  onTestFinished(() => rm(source, { recursive: true, force: true }))
  await writeFile(join(source, 'data.txt'), 'original')
  const limits = { directory: join(root, 'scratch'), maxBytes: 1024, maxFiles: 10, maxDiffBytes: 65536, timeoutMs: 30000 }
  const git = new WorkspaceGit(ctx.subprocess, await ctx.subprocess.resolveExecutable('git'), limits)
  const signal = new AbortController().signal
  const snapshot = await RolloutWorkspace.capture(git, source, limits, signal)
  try {
    const first = await snapshot.checkout(signal)
    const second = await snapshot.checkout(signal)
    await writeFile(join(first.cwd, 'data.txt'), 'changed')
    expect(await readFile(join(second.cwd, 'data.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(source, 'data.txt'), 'utf8')).toBe('original')
    expect(await snapshot.changes(first, signal)).toContain('+changed')
    expect(await snapshot.changes(second, signal)).toBe('')
    await writeFile(join(first.cwd, '.git'), 'gitdir: /invalid\n')
    expect(await snapshot.changes(first, signal)).toContain('+changed')
  } finally { await snapshot.dispose() }
  await expect(RolloutWorkspace.capture(git, source, { ...limits, maxBytes: 1 }, signal)).rejects.toMatchObject({ code: 'limit' })
  await expect(RolloutWorkspace.capture(git, source, { ...limits, directory: join(source, 'scratch') }, signal))
    .rejects.toMatchObject({ code: 'path' })
})
