/** Explicit preview and adoption tools over the native Harness² service. @module */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Harness2RunId } from '@deepseek-ai/dsh-harness2'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin identity. */
export const name = 'tool-harness2'
/** The native engine owns budgets, child execution, and persistence. */
export const inject = ['harness2', 'tools']
/** This consumer has no policy overrides; configure the engine instead. */
export interface Config {}
/** Empty consumer configuration. */
export const Config: z<Config> = z.object({})

/**
 * Register bounded candidate exploration and explicit domain adoption. Model tool calls and
 * results use the ordinary Session log; engine records link their child evidence.
 * @param ctx - effect-owning plugin context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'harness2',
    description: 'Compare alternative approaches for a complex or uncertain task with a bounded Harness² propose–probe–compose preview when the extra exploration is useful. '
      + 'Runs bounded parallel or sequential recursion with durable resumable stages. Solver children may use configured read-only DSH tools within your current permissions and candidate-scoped resources; isolated code execution additionally requires approval. '
      + 'Speculative stages do not run shell commands, write the parent workspace, or apply external changes. Apply selected changes through the normal parent tools only after reviewing the returned evidence. '
      + 'Returns an answer, candidate instructions, reflection, and evidence session ids. This does not verify correctness or adopt the candidate. '
      + 'Show the preview to the user before calling harness2_remember.',
    parameters: {
      task: { type: 'string', required: true, description: 'Complete task and relevant source paths or material, without secrets; permitted read-only tools may inspect task inputs.' },
      domain: { type: 'string', required: true, description: 'Stable domain-library key; only explicitly remembered guidance from this domain is reused.' },
      mode: { type: 'string', enum: ['parallel', 'sequential'], description: 'Independent parallel compositions or sequential refinement with growing history.' },
      k: { type: 'integer', description: 'Width or depth, within deployment limits; 4k rollouts and 3k improvement stages.' },
      resumeRunId: { type: 'string', description: 'Resume the same task and settings from durable stage checkpoints.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true }, domain: { type: 'string', required: true },
          answer: { type: 'string', required: true }, instructions: { type: 'string', required: true },
          reflection: { type: 'string', required: true },
          mode: { type: 'string', required: true }, k: { type: 'integer', required: true },
          selected: { type: 'string', required: true },
          candidate: { type: 'object', additionalProperties: true, required: true },
          finals: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            trajectory: { type: 'string' }, error: { type: 'string' }, label: { type: 'string', required: true }, answer: { type: 'string', required: true },
            candidate: { type: 'object', additionalProperties: true, required: true },
          } } },
          stages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { phase: { type: 'string', required: true }, sessionId: { type: 'string', required: true }, label: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('Harness² requires a calling Agent')
      const result = await ctx.harness2.run({ parent: exec.agent, task: args.task, domain: args.domain, signal: exec.signal,
        ...args.mode === undefined ? {} : { mode: args.mode }, ...args.k === undefined ? {} : { k: args.k },
        ...args.resumeRunId === undefined ? {} : { resumeRunId: Harness2RunId(args.resumeRunId) } })
      return {
        ...result,
        stages: result.stages.map(stage => ({ phase: stage.phase, sessionId: stage.sessionId,
          ...stage.label === undefined ? {} : { label: stage.label } })),
        finals: result.finals.map(final => ({ label: final.label, answer: final.answer, candidate: final.candidate,
          ...final.error === undefined ? {} : { error: final.error },
          ...final.trajectory === undefined ? {} : { trajectory: final.trajectory } })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Harness² preview', rawInput: args.task }),
    presentResult: () => ({ card: 'generic' }),
  }))
  ctx.tools.register(defineTool({
    name: 'harness2_remember',
    description: 'Remember a reviewed Harness² preview only after the user explicitly approves saving that preview. '
      + 'The preview must belong to this session and use the current domain-library revision. '
      + 'It affects future Harness² experiments in that domain, not the current conversation, permissions, tools, or global prompts.',
    parameters: { runId: { type: 'string', required: true, description: 'Run id of the preview the user approved.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { revision: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('Harness² adoption requires a calling Agent')
      exec.signal.throwIfAborted()
      return { revision: await ctx.harness2.remember(exec.agent, Harness2RunId(args.runId), { signal: exec.signal, callId: exec.callId }) }
    },
    presentCall: args => ({ card: 'generic', title: 'Remember Harness² preview', rawInput: args.runId }),
    presentResult: () => ({ card: 'generic' }),
  }))
}
