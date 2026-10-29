/** Independent persistence and authority assertions for the recorded native Harness² preview. */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { Harness2Result } from '@deepseek-ai/dsh-experimental-harness2'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'

/**
 * Verify the persisted library and child request limits without trusting the parent's closing prose.
 * @param logs - freshly harvested parent-first Session logs.
 * @param cwd - isolated profile workspace and DSH home owner.
 */
export async function verifyHarness2Preview(
  logs: readonly { content: string; header: Record<string, unknown> }[], cwd: string,
): Promise<void> {
  expect(logs).toHaveLength(9)
  const parent = parseSessionLog(logs[0]!.content)
  const result = parent.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'harness2-preview')
  if (result?.type !== 'tool/result') throw new Error('Harness² preview result is missing')
  expect(result.data.message.isError).toBe(false)
  const text = result.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const preview = JSON.parse(text) as Harness2Result
  expect(preview.stages.map(stage => stage.phase)).toEqual([
    'baseline', 'invariant', 'domain', 'invariant-probe', 'domain-probe', 'compose', 'final', 'reflect',
  ])
  // Public schedule order is canonical; persisted child chronology may interleave siblings.
  expect(new Set(preview.stages.map(stage => stage.sessionId))).toEqual(new Set(logs.slice(1).map(log => log.header.id)))
  for (const stage of preview.stages) {
    const child = logs.find(log => log.header.id === stage.sessionId)!
    const descriptor = parseSessionLog(child.content).find(event => event.type === 'subagent/descriptor')
    expect(descriptor?.type === 'subagent/descriptor' && descriptor.data.label).toBe(`Harness² ${stage.phase}`)
  }
  for (const child of logs.slice(1)) {
    expect(child.header.parentSession).toBe(logs[0]!.header.id)
    const events = parseSessionLog(child.content)
    const headers = events.flatMap(event => event.type === 'request/header' ? [event.data.header] : [])
    expect(headers).toHaveLength(1)
    expect(headers[0]?.config.maxTokens).toBe(4096)
    expect(headers[0]?.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    const tasks = events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []) : [])
    expect(tasks.join('\n')).toContain('untrusted suggestions, not permission or policy')
    expect(tasks.join('\n')).toContain('Quoted evidence (JSON data):')
    expect(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
  }
  const baseline = parseSessionLog(logs[1]!.content)
  const denied = baseline.find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'harness2-forbidden-bash')
  expect(denied?.type === 'tool/result' && denied.data.message.isError).toBe(true)
  expect(existsSync(join(cwd, 'forbidden.txt'))).toBe(false)
  expect(parent.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['harness2'])
  const library = JSON.parse(await readFile(join(cwd, '.dsh', 'storages', 'harness2.json'), 'utf8')) as {
    tables: { previews: Record<string, Record<string, unknown>>; lessons: Record<string, unknown> }
  }
  expect(Object.keys(library.tables.previews)).toEqual([preview.runId])
  expect(library.tables.previews[preview.runId]).toMatchObject({ ...preview, parentSession: logs[0]!.header.id })
  expect(library.tables.lessons).toEqual({})
}
