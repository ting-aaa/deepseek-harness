/** Scoped native candidate tools and deny-only middleware. @module */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { candidateCatalog } from './candidate.ts'
import type { CandidateTree } from './candidate.ts'
import type { CandidateRuntime } from './candidate-runtime.ts'

/** Candidate capabilities supplied by the engine, never by model arguments. */
export interface CandidateResourceOptions {
  /** Absent means executable candidates fail closed, rather than becoming inert text. */
  runtime?: CandidateRuntime
  /** Fresh bounded managed child; the engine owns its Session, budget, restrictions and drain. */
  delegate(path: string, instructions: string, task: string, signal: AbortSignal): Promise<string>
  signal: AbortSignal
}
/** Install per-Agent tools; registration effects are owned by the Agent's Cordis scope.
 * @param agent - Exact rollout child, never the parent conversation.
 * @param tree - Validated candidate files; loaded skill text is returned through logged tools.
 * @param options - Host-owned execution and bounded delegation capabilities.
 * @returns Allowed tool names for the engine's final executor guard.
 */
export async function installCandidateResources(
  agent: Agent, tree: CandidateTree, options: CandidateResourceOptions,
): Promise<readonly string[]> {
  const catalog = candidateCatalog(tree)
  const runtime = options.runtime
  if (catalog.scripts.length || catalog.plugins.length) {
    if (runtime === undefined) throw new Error('Executable Harness² candidate requires configured isolated runtime; no host fallback')
    await runtime.preflight(options.signal)
  }
  const names = [STRUCTURED_OUTPUT_TOOL]
  if (catalog.skills.length) {
    names.push('harness2_skill')
    agent.ctx.tools.register(defineTool({
      name: 'harness2_skill', description: `Read a candidate workflow on demand. Available paths: ${catalog.skills.join(', ')}`,
      parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute(args) {
        const content = tree[args.path]
        if (!catalog.skills.includes(args.path) || content === undefined) throw new Error('Unknown candidate skill')
        return Promise.resolve(content)
      },
    }))
  }
  if (catalog.subagents.length) {
    names.push('harness2_delegate')
    agent.ctx.tools.register(defineTool({
      name: 'harness2_delegate', description: `Delegate to a fresh bounded candidate agent. Available paths: ${catalog.subagents.join(', ')}`,
      parameters: { path: { type: 'string', required: true }, task: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute(args, exec) {
        const content = tree[args.path]
        if (!catalog.subagents.includes(args.path) || content === undefined) throw new Error('Unknown candidate subagent')
        return options.delegate(args.path, content, args.task, exec.signal)
      },
    }))
  }
  if (catalog.scripts.length && runtime !== undefined) {
    names.push('harness2_script')
    agent.ctx.tools.register(defineTool({
      name: 'harness2_script', description: `Run an approved isolated Python helper with JSON input/output. Available paths: ${catalog.scripts.join(', ')}`,
      parameters: { path: { type: 'string', required: true }, input: { type: 'string', required: true, description: 'JSON request, not shell arguments.' } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute(args, exec) {
        if (!catalog.scripts.includes(args.path)) throw new Error('Unknown candidate script')
        return JSON.stringify(await runtime.run(tree, args.path, args.input, exec.signal))
      },
    }))
  }
  if (catalog.plugins.length && runtime !== undefined) {
    agent.ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind === 'deny' || decision.kind === 'cancel') return decision
      for (const path of catalog.plugins) {
        const response = await runtime.run(tree, path, JSON.stringify({ event: 'before-tool', name: exec.name, args: exec.arguments }), exec.signal)
        const result = response !== null && typeof response === 'object' && 'value' in response ? response.value : undefined
        if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)
          || !('deny' in result) || Object.keys(result).length !== 1 || (result.deny !== null && typeof result.deny !== 'string')) {
          return { kind: 'deny', reason: 'Candidate middleware returned invalid deny-only response' }
        }
        if (typeof result.deny === 'string') return { kind: 'deny', reason: result.deny }
      }
      return decision
    })
  }
  return names
}
