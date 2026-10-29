/** Presentation fixture for a text-only preview; directory operations remain production-owned. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Scenario-local Loader identity. */
export const name = 'harness2-preview-runtime-context'
/** Keep the real directory owner and prompt service active. */
export const inject = ['systemPrompt', 'workingDirectory']

/**
 * Omit only directory prose from this preview's requests; dedicated directory scenarios cover it.
 * @param ctx - effect-owning fixture context.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.systemPrompt.context({
      name: 'working-directory:current',
      order: agent.ctx.systemPrompt.getContextOrder('WORKING_DIRECTORY'),
      text: '',
      required: false,
      interpolate: false,
    })
    agent.ctx.on('system-prompt/assemble', async (_presentation, _context, continueAssembly) => {
      const presentation = await continueAssembly()
      return { ...presentation, contexts: presentation.contexts.filter(entry => entry.name !== 'working-directory:current') }
    }, { prepend: true })
  })
}
