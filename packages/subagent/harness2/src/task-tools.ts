/** Read-only task capabilities captured from one initiating parent; speculative children never apply changes. @module */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolActivationContext, ToolDefinition } from '@deepseek-ai/dsh-tools'

/** First-party task operations with no workspace mutation or command execution. */
export const READ_ONLY_TASK_TOOLS = ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch'] as const
/** Deployment may select a subset of the supported read-only task operations. */
export type ReadOnlyTaskTool = typeof READ_ONLY_TASK_TOOLS[number]

/** One run's fixed tool definitions and exact live initiating parent. */
export class TaskToolAuthority {
  private constructor(
    readonly parent: Agent,
    private readonly definitions: ReadonlyMap<string, ToolDefinition>,
  ) {}

  /**
   * Capture parent-visible, currently admitted definitions before any speculative stage starts.
   * @param parent - Exact live initiating parent, not a rollout child.
   * @param names - Deployment-owned subset; model arguments cannot widen it.
   * @param signal - Cancels conditional admission before any tools are installed.
   * @returns Fixed authority whose live revocations are checked at every step and dispatch.
   */
  static async capture(parent: Agent, names: readonly ReadOnlyTaskTool[], signal: AbortSignal): Promise<TaskToolAuthority> {
    const tools = parent.ctx.tools
    const snapshot = new Map(names.flatMap((name) => {
      const definition = tools.get(name, parent)
      return definition === undefined ? [] : [[name, definition] as const]
    }))
    const modelSelection = parent.model.current()
    if (modelSelection === undefined) throw new Error('Harness² task capabilities require a selected parent model')
    const admitted = await tools.resolve({ agent: parent, modelSelection, signal })
    try {
      const visible = admitted.view(parent)
      return new TaskToolAuthority(parent, new Map([...snapshot].filter(([name, definition]) => visible.get(name) === definition)))
    } finally {
      admitted.dispose()
    }
  }

  /**
   * Install scoped read-only definitions, preserving parent revocations, identity and guards.
   * The normal child pipeline still enforces its delegated permission and never-approval policy.
   * @param child - Solver child owning these registrations and their disposal.
   * @returns Names available to the engine's final capability guard.
   */
  install(child: Agent): readonly string[] {
    const { parent } = this
    const tools = parent.ctx.tools
    const admissions = new WeakMap<ToolActivationContext, Promise<ReadonlyMap<string, ToolDefinition>>>()
    const admittedFor = (context: ToolActivationContext): Promise<ReadonlyMap<string, ToolDefinition>> => {
      let admission = admissions.get(context)
      if (admission === undefined) {
        admission = (async () => {
          const modelSelection = parent.model.current()
          if (modelSelection === undefined) return new Map<string, ToolDefinition>()
          const resolved = await tools.resolve({ agent: parent, modelSelection, signal: context.signal })
          try { return new Map(resolved.view(parent)) } finally { resolved.dispose() }
        })()
        admissions.set(context, admission)
      }
      return admission
    }
    const live = () => parent.ctx.agents.get(parent.id) === parent
    for (const [name, definition] of this.definitions) {
      child.ctx.tools.register(definition, { when: async context => live()
        && tools.get(name, parent) === definition && (await admittedFor(context)).get(name) === definition })
    }
    child.ctx.tools.guard((exec) => {
      const definition = this.definitions.get(exec.name)
      if (definition === undefined) return undefined
      if (!live() || tools.get(exec.name, parent) !== definition || tools.get(exec.name, child) !== definition) {
        return 'Harness² parent task capability was revoked or replaced.'
      }
      return tools.checkGuards({ ...exec, agent: parent })
    })
    return [...this.definitions.keys()]
  }
}
