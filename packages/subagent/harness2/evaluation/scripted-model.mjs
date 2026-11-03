/** Deterministic plumbing model; its synthetic outcomes never measure model quality. */
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { TASK } from './suite.ts'

function* tool(id, name, args) {
  const block = { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) }
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

function* done() {
  const block = { type: 'text', text: 'Completed scripted plumbing step.' }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: block.text }
  yield { type: 'block-end', index: 0, block }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

class ScriptedModel extends LlmAdapter {
  async *stream(options) {
    const users = options.messages.filter(message => message.role === 'user').map(message =>
      message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    const text = users.join('\n')
    const latest = users.findLast(value => value.includes('H2_EVAL_')) ?? users.at(-1) ?? ''
    const results = options.messages.filter(message => message.role === 'tool')
    const seen = id => results.some(message => message.toolCallId === id)
    if (text.includes('Read context/task.md for the task and context/evidence.json')) {
      if (text.includes('You are reading the complete record')) yield* tool('reflection', 'structured_output', {
        cue: 'Ledger aggregation', lesson: 'NO_ENTRY', evidence: 'Scripted smoke has no quality evidence.', edits: '[]',
      })
      else if (!seen('edit-guidance')) yield* tool('edit-guidance', 'write', {
        file_path: 'context/harness/systemprompt.md', content: 'Check signed totals, zero groups, and ASCII ordering before delivery.',
      })
      else yield* tool('notes', 'structured_output', { notes: 'Synthetic guidance for transport verification only.' })
      return
    }
    if (text.includes('Assignment:\nComplete the task') || latest.includes('H2_EVAL_SOLVE')) {
      if (!seen('read-input')) { yield* tool('read-input', 'read', { file_path: 'input.json' }); return }
      if (!seen('write-output')) {
        const read = results.find(message => message.toolCallId === 'read-input')
        const body = read.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        const rows = JSON.parse(body.split('\n').filter(line => /^\d+: /.test(line)).map(line => line.replace(/^\d+: /, '')).join('\n'))
        const sums = new Map()
        for (const row of rows) sums.set(row.account, (sums.get(row.account) ?? 0) + row.amount)
        const output = [...sums.keys()].sort().map(account => ({ account, total: sums.get(account) }))
        yield* tool('write-output', 'write', { file_path: 'output.json', content: JSON.stringify(output) })
      } else if (latest.includes('H2_EVAL_SOLVE')) yield* done()
      else yield* tool('answer', 'structured_output', { answer: 'Created the ledger artifact in the private copy.' })
      return
    }
    if (options.messages.at(-1)?.role === 'tool') { yield* done(); return }
    if (latest.includes('H2_EVAL_TRAIN')) yield* tool('preview', 'harness2', { task: TASK, domain: 'evaluation-ledger', k: 1 })
    else if (latest.includes('H2_EVAL_REMEMBER')) yield* tool('remember', 'harness2_remember', { runId: latest.match(/runId=([^\s.]+)/)[1] })
    else if (latest.includes('H2_EVAL_APPLY')) yield* tool('apply', 'harness2_apply', { runId: latest.match(/runId=([^\s.]+)/)[1] })
    else if (latest.includes('H2_EVAL_ACTIVATE')) yield* tool('activate', 'harness2_activate', {
      domain: 'evaluation-ledger', mode: 'parallel', revision: Number(latest.match(/revision=(\d+)/)[1]),
    })
    else yield* done()
  }
}

/** Cordis plugin identity. */
export const name = 'harness2-eval-smoke'
/** Model registry dependency. */
export const inject = ['llm']
/** Register a model that exercises real profile tools without a provider credential. */
export function apply(ctx) { ctx.llm.registerAdapter(['harness2-eval-smoke'], new ScriptedModel()) }
