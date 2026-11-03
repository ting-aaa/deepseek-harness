/** File-editor readback preserves KEEP_BASE and refuses unsafe or oversized candidate files. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { EditorWorkspace } from '../src/editor-workspace.ts'
import type { EditorInput } from '../src/editor-workspace.ts'

const limits = { maxFiles: 8, maxFileBytes: 256, maxTotalBytes: 512, maxAlwaysOnChars: 256 }
const base: EditorInput = {
  task: 'Review the task.', current: { 'systemprompt.md': 'Keep checks.', 'guardrails.md': 'No external writes.' },
  evidence: { history: [{ label: 'inv1', candidate: { 'systemprompt.md': 'Inspect first.' },
    trajectory: 'Observed execution.', answer: 'Done.', changes: 'diff' }] },
  library: [{ task: 'Prior task', reflection: 'Keep checks.', candidate: { 'systemprompt.md': 'Inspect prior data.' } }],
  agent: { systemPrompt: 'Fixed host prompt', tools: [], skills: [], cwd: '/source' },
}

async function context(input: EditorInput = base, bytes = 65536) {
  const parent = await mkdtemp(join(tmpdir(), 'harness2-editor-unit-'))
  onTestFinished(() => rm(parent, { recursive: true, force: true }))
  const editor = await EditorWorkspace.create(parent, input, limits, bytes)
  onTestFinished(() => editor.dispose())
  return editor
}

it('keeps unchanged candidates and supplies complete candidate-pool and accepted-library files', async () => {
  const editor = await context()
  expect(await editor.candidate()).toEqual(base.current)
  expect(await readFile(join(editor.cwd, 'context/pool/inv1/harness/systemprompt.md'), 'utf8')).toBe('Inspect first.')
  expect(await readFile(join(editor.cwd, 'context/library/task-1/harness/systemprompt.md'), 'utf8')).toBe('Inspect prior data.')
  expect(editor.permitsWrite({ file_path: 'context/harness/systemprompt.md' })).toBe(true)
  for (const args of [{ file_path: 'context/task.md' }, { file_path: '../outside' }, { file_path: 'context/harness' }, {}, null]) {
    expect(editor.permitsWrite(args)).toBe(false)
  }
})

it.each(['', 'DELETE'])('removes an optional component marked %j', async (content) => {
  const editor = await context()
  await writeFile(join(editor.cwd, 'context/harness/guardrails.md'), content)
  expect(await editor.candidate()).toEqual({ 'systemprompt.md': 'Keep checks.' })
})

it('rejects oversized contexts and candidate files without accepting a partial tree', async () => {
  await expect(context(base, 1)).rejects.toThrow('context exceeds')
  const editor = await context()
  await writeFile(join(editor.cwd, 'context/harness/systemprompt.md'), 'x'.repeat(257))
  await expect(editor.candidate()).rejects.toThrow('file limits')
  await writeFile(join(editor.cwd, 'context/harness/systemprompt.md'), 'Valid')
  await mkdir(join(editor.cwd, 'context/harness/bad'))
  await writeFile(join(editor.cwd, 'context/harness/bad/path.txt'), 'Not an allowed component.')
  await expect(editor.candidate()).rejects.toThrow()
})

it.runIf(process.platform !== 'win32')('rejects a candidate symlink rather than following it', async () => {
  const editor = await context()
  await symlink('../task.md', join(editor.cwd, 'context/harness/LongTermMEMORY.md'))
  await expect(editor.candidate()).rejects.toThrow('symbolic links')
})
