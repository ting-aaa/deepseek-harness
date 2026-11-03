/** Native bounded Harness² orchestration over managed DSH children and domain storage. @module */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, isAbsolute, relative, resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent'
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-fs'
import { candidateCatalog, candidateHash, candidateInstructions, validateCandidateTree } from './candidate.ts'
import type { CandidateTree } from './candidate.ts'
import { installCandidateResources } from './candidate-resources.ts'
import { IsolatedCandidateRuntime } from './isolated-runtime.ts'
import type { CandidateExecutionAuthority, IsolatedRuntimeConfig } from './isolated-runtime.ts'
import { WasiCandidateRuntime } from './wasi-runtime.ts'
import { WASI_DEFAULTS } from './wasi-config.ts'
import type { WasiRuntimeConfig } from './wasi-config.ts'
import { runSchedule } from './schedule.ts'
import { libraryKey, librarySpec, revisionKey, usageSchema } from './records.ts'
import type { PreviewRecord, RevisionRecord } from './records.ts'
import { overlaySkills, overlayText, workspaceRoot } from './overlay.ts'
import type { Harness2Binding } from './overlay.ts'
import { overlayProjection } from './overlay-projection.ts'
import type { OverlayState } from './overlay-projection.ts'
import { childPrompt, COMPOSE_MISSION, DOMAIN_MISSION, INVARIANT_MISSION, REFLECT_MISSION, SELECT_MISSION,
  SOLVE_MISSION, TREE_MISSION, WORKSPACE_SOLVE_MISSION } from './prompts.ts'
import type { Harness2Request, Harness2Result, Harness2RunId, Harness2Stage } from './types.ts'
import { READ_ONLY_TASK_TOOLS, WORKSPACE_TASK_TOOLS, TaskToolAuthority } from './task-tools.ts'
import type { ReadOnlyTaskTool } from './task-tools.ts'
import { libraryEvidence } from './library-evidence.ts'
import { createTrace, fitEvidence, pushTrace, renderTrace } from './evidence-fit.ts'
import type { ExecutionTrace } from './evidence-fit.ts'
import { settleActivation } from './activation.ts'
import { RolloutWorkspace, WorkspaceGit, WorkspaceFailure } from './workspace.ts'
import { EditorWorkspace } from './editor-workspace.ts'
import type { EditorInput } from './editor-workspace.ts'
import { proposePrompt, aggregatePrompt, composeRoundPrompt, selectPrompt, experiencePrompt } from './editor-prompts.ts'

export type { Harness2Request, Harness2Result, Harness2Stage } from './types.ts'
export { Harness2RunId } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    harness2: Harness2Engine
  }
}

/** Deployment-owned budgets; the tools cannot raise any of these limits. */
export interface Config {
  /** File-based upstream editing, or compact JSON-tree authoring for smaller compositions. */
  editor?: 'filesystem' | 'json'
  /** Default workspace execution requires a confining filesystem and shell; unavailable capabilities use read-only execution. */
  rollout?: 'workspace' | 'read-only'
  /** Absolute scratch parent outside the source workspace and shared OS temporary directories. */
  scratchDirectory?: string
  /** Maximum source bytes copied for one run. */
  maxScratchBytes?: number
  /** Maximum source files copied for one run. */
  maxScratchFiles?: number
  /** Maximum patch and Git-listing bytes retained per command. */
  maxDiffBytes?: number
  /** Provider-reported total input and output tokens per child, shared with its nested delegates. */
  maxRolloutTokens?: number
  /** Fresh, local, structured-output subagent provider; defaults to spawn. */
  provider?: string
  /** Default recursion mode, overridable within the configured k budget. */
  mode?: 'parallel' | 'sequential'
  /** Default recursion width/depth. */
  k?: number
  /** Maximum request recursion width/depth. */
  maxK?: number
  /** Maximum candidate file count. */
  maxCandidateFiles?: number
  /** Maximum UTF-8 bytes in one candidate file. */
  maxCandidateFileBytes?: number
  /** Maximum UTF-8 bytes in the complete candidate. */
  maxCandidateBytes?: number
  /** Portable WASI execution by default; explicit Linux namespace configuration remains supported. Null disables executable candidates. */
  runtime?: WasiRuntimeConfig | IsolatedRuntimeConfig | null
  /** Read-only solver/reviewer subset; workspace solvers additionally admit the fixed coding-tool allowlist. */
  readTools?: ReadOnlyTaskTool[]
  /** Retained full-tree experiences per domain. */
  maxLibraryEntries?: number
  /** Maximum concurrent top-level children; delegated leaf children do not hold this semaphore. */
  maxConcurrentChildren?: number
  /** Complete serialized execution trajectory characters per rollout, including nested children. */
  maxTrajectoryChars?: number
  /** Fixed baseline tree; remembered experiences are separate improvement evidence. */
  baseCandidate?: CandidateTree
  /** Maximum task characters; defaults to 16000. */
  maxTaskChars?: number
  /** Maximum characters in one candidate instruction set; defaults to 8000. */
  maxInstructionsChars?: number
  /** Maximum complete serialized child message characters; defaults to 64000. */
  maxEvidenceChars?: number
  /** Maximum answer characters; defaults to 16000. */
  maxOutputChars?: number
  /** Maximum rationale or reflection characters; defaults to 8000. */
  maxReflectionChars?: number
  /** Wall-clock milliseconds per child, including startup; defaults to 900000. */
  childTimeoutMs?: number
  /** Maximum admitted steps per child; defaults to 40. */
  maxStepsPerChild?: number
  /** Per-request output-token cap; defaults to 16384, never raises the parent's cap. */
  maxTokensPerChild?: number
  /** Concurrent preview ceiling; defaults to 1. */
  maxConcurrentRuns?: number
  /** Inactive run/checkpoint retention at admission and completed previews at commit; defaults to 50. */
  maxSavedRuns?: number
}

const DEFAULTS = {
  editor: 'filesystem',
  rollout: 'workspace', scratchDirectory: join(homedir(), '.dsh', 'harness2-scratch'),
  maxScratchBytes: 256 * 1024 * 1024, maxScratchFiles: 50_000, maxDiffBytes: 2 * 1024 * 1024, maxRolloutTokens: 200_000,
  readTools: [...READ_ONLY_TASK_TOOLS],
  runtime: { backend: 'wasi' }, maxLibraryEntries: 16, maxConcurrentChildren: 4, maxTrajectoryChars: 16_000, baseCandidate: { 'systemprompt.md': '' }, provider: 'spawn', mode: 'parallel', k: 1, maxK: 4, maxCandidateFiles: 64, maxCandidateFileBytes: 32_000, maxCandidateBytes: 128_000, maxTaskChars: 16_000, maxInstructionsChars: 8_000,
  maxEvidenceChars: 64_000, maxOutputChars: 16_000, maxReflectionChars: 8_000,
  childTimeoutMs: 900_000, maxStepsPerChild: 40, maxTokensPerChild: 16384,
  maxConcurrentRuns: 1, maxSavedRuns: 50,
} satisfies Required<Config>

type ResolvedConfig = Omit<Required<Config>, 'readTools'> & { readonly readTools: readonly ReadOnlyTaskTool[] }

function resolveConfig(config: Config): ResolvedConfig {
  const resolved = { ...DEFAULTS, ...config }
  if (!isAbsolute(resolved.scratchDirectory)) throw new TypeError('Harness² scratchDirectory must be absolute')
  const temporary = relative(resolve(tmpdir()), resolve(resolved.scratchDirectory))
  if (temporary === '' || temporary !== '..' && !temporary.startsWith(`..${sep}`) && !isAbsolute(temporary)) {
    throw new TypeError('Harness² scratchDirectory must be outside the shared OS temporary directory')
  }
  if (resolved.provider.trim() !== resolved.provider || !resolved.provider) {
    throw new TypeError('Harness² provider must be a non-empty normalized name')
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!['provider', 'mode', 'runtime', 'baseCandidate', 'readTools', 'rollout', 'scratchDirectory', 'editor'].includes(key)
      && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError(`Harness² ${key} must be a positive safe integer`)
    }
  }
  if (resolved.k > resolved.maxK) throw new TypeError('Harness² default k exceeds maxK')
  validateCandidateTree(resolved.baseCandidate, { maxFiles: resolved.maxCandidateFiles, maxFileBytes: resolved.maxCandidateFileBytes,
    maxTotalBytes: resolved.maxCandidateBytes, maxAlwaysOnChars: resolved.maxInstructionsChars })
  return { ...resolved, readTools: Object.freeze([...new Set(resolved.readTools)]) }
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`Harness² ${field} must be non-empty text with at most ${max} characters`)
  }
  return value
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Harness² child did not return a structured object')
  }
  return value as Record<string, unknown>
}

function schema(fields: readonly string[]): ObjectJsonSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map(field => [field, { type: 'string' }])),
    required: [...fields], additionalProperties: false,
  }
}

class ChildExecutionFailure extends Error {
  /** Bounded trajectory observed before the failure, retained as improvement evidence. */
  evidence: string | undefined
  usage: { inputTokens: number; outputTokens: number } | undefined
}

function contentDigest(input: object): string {
  const serialized = JSON.stringify(input, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')))
  })
  return createHash('sha256').update(serialized).digest('hex')
}

function runId(value: string): Harness2RunId {
  return value as Harness2RunId
}

/** Native recursive candidate service; the tool consumer owns schema and presentation. */
export class Harness2Engine extends Service {
  static inject = ['agents', 'subagents', 'tools', 'storageDomain', 'approval', 'workingDirectory', 'sessionProjections', 'systemPrompt', 'skills']
  static Config: z<Config> = z.object({
    editor: z.union(['filesystem', 'json']).default(DEFAULTS.editor),
    rollout: z.union(['workspace', 'read-only']).default(DEFAULTS.rollout),
    scratchDirectory: z.string().default(DEFAULTS.scratchDirectory),
    maxScratchBytes: z.number().step(1).min(1).default(DEFAULTS.maxScratchBytes),
    maxScratchFiles: z.number().step(1).min(1).default(DEFAULTS.maxScratchFiles),
    maxDiffBytes: z.number().step(1).min(1).default(DEFAULTS.maxDiffBytes),
    maxRolloutTokens: z.number().step(1).min(1).default(DEFAULTS.maxRolloutTokens),
    provider: z.string().default(DEFAULTS.provider),
    mode: z.union(['parallel', 'sequential']).default(DEFAULTS.mode),
    k: z.number().step(1).min(1).default(DEFAULTS.k),
    maxK: z.number().step(1).min(1).default(DEFAULTS.maxK),
    maxCandidateFiles: z.number().step(1).min(1).default(DEFAULTS.maxCandidateFiles),
    maxCandidateFileBytes: z.number().step(1).min(1).default(DEFAULTS.maxCandidateFileBytes),
    maxCandidateBytes: z.number().step(1).min(1).default(DEFAULTS.maxCandidateBytes),
    maxConcurrentChildren: z.number().step(1).min(1).default(DEFAULTS.maxConcurrentChildren),
    maxTrajectoryChars: z.number().step(1).min(1).default(DEFAULTS.maxTrajectoryChars),
    maxLibraryEntries: z.number().step(1).min(1).default(DEFAULTS.maxLibraryEntries),
    baseCandidate: z.dict(z.string()).default(DEFAULTS.baseCandidate),
    readTools: z.array(z.union(READ_ONLY_TASK_TOOLS)).default([...DEFAULTS.readTools]),
    runtime: z.union([z.const(null), z.object({
      backend: z.const('wasi').required(),
      timeoutMs: z.number().step(1).min(1).default(WASI_DEFAULTS.timeoutMs),
      maxInputBytes: z.number().step(1).min(1).default(WASI_DEFAULTS.maxInputBytes),
      maxOutputBytes: z.number().step(1).min(1).default(WASI_DEFAULTS.maxOutputBytes),
      memoryBytes: z.number().step(1).min(32 * 1024 * 1024).max(4 * 1024 * 1024 * 1024).default(WASI_DEFAULTS.memoryBytes),
      workspaceBytes: z.number().step(1).min(1).default(WASI_DEFAULTS.workspaceBytes),
      maxWorkspaceEntries: z.number().step(1).min(1).default(WASI_DEFAULTS.maxWorkspaceEntries),
      cpuSeconds: z.number().step(1).min(1).default(WASI_DEFAULTS.cpuSeconds),
      maxArtifactFiles: z.number().step(1).min(1).default(WASI_DEFAULTS.maxArtifactFiles),
      maxArtifactBytes: z.number().step(1).min(1).default(WASI_DEFAULTS.maxArtifactBytes),
    }), z.object({
      bubblewrapPath: z.string().required(), prlimitPath: z.string().required(), pythonPath: z.string().required(),
      nodePath: z.string().required(), scratchDirectory: z.string().required(),
      timeoutMs: z.number().step(1).min(1).required(), maxInputBytes: z.number().step(1).min(1).required(),
      maxOutputBytes: z.number().step(1).min(1).required(), memoryBytes: z.number().step(1).min(1).required(),
      workspaceBytes: z.number().step(1).min(1).required(), cpuSeconds: z.number().step(1).min(1).required(),
      maxProcesses: z.number().step(1).min(1).required(),
      maxArtifactFiles: z.number().step(1).min(1).required(), maxArtifactBytes: z.number().step(1).min(1).required(),
    })]),
    maxTaskChars: z.number().step(1).min(1).default(DEFAULTS.maxTaskChars),
    maxInstructionsChars: z.number().step(1).min(1).default(DEFAULTS.maxInstructionsChars),
    maxEvidenceChars: z.number().step(1).min(1).default(DEFAULTS.maxEvidenceChars),
    maxOutputChars: z.number().step(1).min(1).default(DEFAULTS.maxOutputChars),
    maxReflectionChars: z.number().step(1).min(1).default(DEFAULTS.maxReflectionChars),
    childTimeoutMs: z.number().step(1).min(1).default(DEFAULTS.childTimeoutMs),
    maxStepsPerChild: z.number().step(1).min(1).default(DEFAULTS.maxStepsPerChild),
    maxTokensPerChild: z.number().step(1).min(1).default(DEFAULTS.maxTokensPerChild),
    maxConcurrentRuns: z.number().step(1).min(1).default(DEFAULTS.maxConcurrentRuns),
    maxSavedRuns: z.number().step(1).min(1).default(DEFAULTS.maxSavedRuns),
  })

  private readonly config: ResolvedConfig
  private readonly lifecycle = new AbortController()
  private readonly active = new Set<Promise<unknown>>()
  private readonly pending = new Map<SessionId, {
    authority: TaskToolAuthority
    task: boolean
    candidate: CandidateTree | undefined
    signal: AbortSignal
    stages: Harness2Stage[]
    trace: ExecutionTrace | undefined
    workspace: boolean
    budget: { inputTokens: number; outputTokens: number; control: AbortController }
    editor: EditorWorkspace | undefined
    tools: boolean
  }>()
  private childSlots = 0
  private readonly slotWaiters = new Set<() => void>()
  private readonly runningIds = new Set<string>()
  private readonly savingDomains = new Set<string>()
  private readonly delegates = new Set<SessionId>()
  private previewCommit: Promise<void> = Promise.resolve()
  private domain!: Domain<typeof librarySpec>
  private overlayState!: ProjectionHandle<OverlayState>

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'harness2')
    this.config = resolveConfig(config)
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    await mkdir(this.config.scratchDirectory, { recursive: true })
    this.config.scratchDirectory = await realpath(this.config.scratchDirectory)
    const temporary = relative(await realpath(tmpdir()), this.config.scratchDirectory)
    if (temporary === '' || temporary !== '..' && !temporary.startsWith(`..${sep}`) && !isAbsolute(temporary)) {
      throw new TypeError('Harness² scratchDirectory must be physically outside the shared OS temporary directory')
    }
    this.domain = await ctx.storageDomain.open(librarySpec)
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('Harness² plugin unloaded'))
      await Promise.allSettled([...this.active])
      await this.domain.close()
    }, 'harness2 lifecycle')
    this.overlayState = await ctx.sessionProjections.register(overlayProjection)
    ctx.on('session/event', (session, event) => {
      const pending = this.pending.get(session.id)
      if (event.type === 'assistant/message' && pending !== undefined && event.data.usage !== undefined) {
        pending.budget.inputTokens += event.data.usage.inputTokens
        pending.budget.outputTokens += event.data.usage.outputTokens
        if (pending.budget.inputTokens + pending.budget.outputTokens > this.config.maxRolloutTokens) {
          pending.budget.control.abort(new ChildExecutionFailure('Harness² child exceeded maxRolloutTokens'))
        }
      }
      const trace = pending?.trace
      if (trace === undefined) return
      let payload: object
      if (event.type === 'assistant/message') payload = { type: event.type, message: event.data.message }
      else if (event.type === 'tool/call') payload = { type: event.type, data: event.data }
      else if (event.type === 'tool/result') payload = { type: event.type, message: event.data.message }
      else return
      pushTrace(trace, JSON.stringify({ sessionId: session.id, seq: event.seq, ...payload }))
    })
    ctx.on('agent/created', async ({ agent }) => {
      const pending = this.pending.get(agent.id)
      if (pending === undefined) {
        if (this.delegates.has(agent.id)) this.limitSteps(agent)
        await this.installOverlay(agent)
        return
      }
      if (pending.workspace) {
        const policy = this.ctx.get('sandboxPolicy')
        if (policy === undefined) throw new Error('Harness² workspace execution requires sandboxPolicy')
        policy.setWorkspaceRoot(agent.session, this.ctx.workingDirectory.get(agent.session))
        agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'delegation' })
        agent.session.append('approval/policy', { policy: 'never', source: 'delegation' })
      }
      let allowed: readonly string[] = [STRUCTURED_OUTPUT_TOOL]
      // Install the final guard before awaiting resource initialization.
      agent.ctx.tools.restrict({ allow: [] })
      agent.ctx.tools.guard(exec => allowed.includes(exec.name)
        ? undefined : 'Harness² children may only use their declared candidate resources and structured output.')
      if (pending.editor !== undefined) {
        const editor = pending.editor
        agent.ctx.tools.guard(exec => (exec.name === 'write' || exec.name === 'edit') && !editor.permitsWrite(exec.arguments)
          ? 'Harness² editors may only change context/harness; task material and evidence are read-only.' : undefined)
      }
      agent.ctx.tools.setExecutor(new NativeToolExecutor(agent.ctx))
      const taskTools = pending.task || pending.tools ? pending.authority.install(agent) : []
      if (pending.candidate !== undefined) {
        const authority: CandidateExecutionAuthority = {
          approve: async (request, signal) => await ctx.approval.request({ agent: pending.authority.parent, signal, toolName: 'harness2_candidate_execute',
            reason: `Execute isolated candidate ${request.hash} entry ${request.path} with exact JSON input:\n${request.input}` }) === 'allowed-once',
          audit: event => agent.session.append('harness2/execution', event),
        }
        const runtimeConfig = this.config.runtime
        const runtime = runtimeConfig === null ? undefined : 'backend' in runtimeConfig
          ? new WasiCandidateRuntime(runtimeConfig, authority) : new IsolatedCandidateRuntime(runtimeConfig, authority)
        allowed = await installCandidateResources(agent, pending.candidate, {
          ...runtime === undefined ? {} : { runtime }, signal: pending.signal,
          delegate: async (path, instructions, task, signal) => {
            boundedText(task, 'delegated task', this.config.maxTaskChars)
            const prompt = childPrompt(task, pending.workspace ? WORKSPACE_SOLVE_MISSION : SOLVE_MISSION,
              { subagent: path, instructions }, pending.workspace)
            boundedText(prompt, 'complete delegated message', this.config.maxEvidenceChars)
            const output = await this.child(agent, 'final', prompt, ['answer'], signal, pending.stages)
            return boundedText(output['answer'], 'delegated answer', this.config.maxOutputChars)
          },
        })
      }
      allowed = [...allowed, ...taskTools]
      this.limitSteps(agent)
    })
  }

  /**
   * Run a bounded recursive preview with durable per-stage checkpoints. Failed rollouts remain
   * evidence when another baseline and final are usable. Cancellation or infrastructure failure
   * drains children while retaining completed stage evidence. The final durable write is not
   * cancellable; aborting after that write begins cannot roll it back. Earlier child logs remain.
   * @param request - exact live parent, task, domain-library key, and cancellation signal.
   * @returns the completed answer, proposed instructions, reflection, and child evidence ids.
   */
  run(request: Harness2Request): Promise<Harness2Result> {
    this.assertLive(request.parent)
    request.signal.throwIfAborted()
    const task = boundedText(request.task, 'task', this.config.maxTaskChars)
    const domain = boundedText(request.domain, 'domain', 128).trim()
    if (this.runningIds.size >= this.config.maxConcurrentRuns) throw new Error('Harness² concurrent preview limit reached')
    const provider = this.ctx.subagents.getProvider(this.config.provider)
    if (provider === undefined || provider.inheritsParentContext || provider.prepareContinuable === undefined
      || !provider.capabilities.outputSchema || !provider.capabilities.agentOptions || !provider.capabilities.depthLimit) {
      throw new Error(`Harness² provider ${this.config.provider} must support fresh local children, structured output, agent options, and depth limits`)
    }
    const mode = request.mode ?? this.config.mode
    const k = request.k ?? this.config.k
    if (!Number.isSafeInteger(k) || k < 1 || k > this.config.maxK) throw new TypeError(`Harness² k must be between 1 and ${this.config.maxK}`)
    const id = request.resumeRunId ?? runId(randomUUID())
    if (this.runningIds.has(id)) throw new Error('Harness² run is already active')
    this.runningIds.add(id)
    const promise = this.execute({ ...request, task, domain }, id, mode, k)
    void promise.then(() => this.runningIds.delete(id), () => this.runningIds.delete(id))
    this.active.add(promise)
    void promise.then(() => this.active.delete(promise), () => this.active.delete(promise))
    return promise
  }

  /**
   * Adopt one completed preview for future runs in its domain. This never changes the
   * parent's prompt, tools, permissions, or workspace. The configured approval answerer must
   * grant this exact request; unavailable, rejected, cancelled, and never-policy asks fail closed.
   * @param parent - exact live originating parent; another Session cannot adopt this preview.
   * @param id - preview id returned by run; repeated adoption is idempotent.
   * @param options - cancellation and optional originating tool call; the parent must have an open turn for approval audit.
   * @returns the committed domain-library revision; rejects if a different preview was adopted since this run began.
   */
  remember(parent: Agent, id: Harness2RunId, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<number> {
    this.assertLive(parent)
    const preview = this.domain.table('previews').get(id)
    if (preview === undefined || preview.parentSession !== parent.id) {
      throw new Error('Harness² preview is absent, expired, or owned by another parent Session')
    }
    if (this.savingDomains.has(libraryKey(preview.mode, preview.domain))) throw new Error('Harness² domain adoption is already in progress')
    this.savingDomains.add(libraryKey(preview.mode, preview.domain))
    const promise = this.adopt(parent, preview, options)
    this.active.add(promise)
    void promise.finally(() => {
      this.savingDomains.delete(libraryKey(preview.mode, preview.domain))
      this.active.delete(promise)
    }).catch(() => { /* The original promise reports adoption failure to its caller. */ })
    return promise
  }

  /**
   * Bind one adopted revision to the caller's workspace so later top-level Agents in that
   * workspace receive it as lower-trust guidance, native skills, and candidate resources.
   * The current conversation is unchanged. Requires a one-time approval grant.
   * @param parent - exact live Agent whose working directory selects the workspace.
   * @param request - domain, optional mode (default configured mode), and optional revision (default latest).
   * @param options - cancellation and optional originating tool call for approval audit.
   * @returns the committed binding.
   */
  activate(parent: Agent, request: { domain: string; mode?: 'parallel' | 'sequential'; revision?: number },
    options: { signal: AbortSignal; callId?: ToolCallId }): Promise<Harness2Binding> {
    this.assertLive(parent)
    return this.track(this.bind(parent, request, options))
  }

  private async bind(parent: Agent, request: { domain: string; mode?: 'parallel' | 'sequential'; revision?: number },
    options: { signal: AbortSignal; callId?: ToolCallId }): Promise<Harness2Binding> {
    this.assertLive(parent)
    const domain = boundedText(request.domain, 'domain', 128).trim()
    const mode = request.mode ?? this.config.mode
    const record = this.revision(mode, domain, request.revision)
    if (record === undefined) throw new Error(`Harness² has no adopted ${mode} revision ${request.revision ?? '(latest)'} for domain ${domain}`)
    const workspace = workspaceRoot(this.ctx.workingDirectory.get(parent.session))
    const signal = AbortSignal.any([options.signal, this.lifecycle.signal])
    const outcome = await this.ctx.approval.request({
      agent: parent, toolName: 'harness2_activate', signal,
      ...options.callId === undefined ? {} : { callId: options.callId },
      reason: `Apply adopted Harness² ${mode} revision ${record.revision} of domain ${domain} to new sessions in ${workspace}? `
        + 'It adds lower-trust guidance, skills, and candidate resources; it never widens permissions.'
        + `\n\nInstructions:\n${record.instructions}\n\nResources: ${JSON.stringify(candidateCatalog(record.candidate))}`,
    })
    if (outcome !== 'allowed-once') throw new Error(`Harness² activation was not approved (${outcome}); the workspace binding is unchanged`)
    signal.throwIfAborted()
    const binding: Harness2Binding = { workspace, domain, mode, revision: record.revision, boundAt: Date.now() }
    await this.domain.table('bindings').put(workspace, binding)
    return binding
  }

  /**
   * Remove the caller workspace's binding; already running Agents keep their installed guidance.
   * @param parent - exact live Agent whose working directory selects the workspace.
   * @returns whether a binding was removed.
   */
  deactivate(parent: Agent): Promise<boolean> {
    this.assertLive(parent)
    return this.track(this.unbind(parent))
  }

  private async unbind(parent: Agent): Promise<boolean> {
    const workspace = workspaceRoot(this.ctx.workingDirectory.get(parent.session))
    const bindings = this.domain.table('bindings')
    if (bindings.get(workspace) === undefined) return false
    await bindings.deleteMany([workspace])
    return true
  }

  /**
   * Describe the caller workspace's binding and the adopted revisions available for rollback.
   * @param parent - exact live Agent whose working directory selects the workspace.
   * @param domain - optional domain filter for listed revisions.
   * @returns the workspace, its binding when present, and revision summaries in ascending order.
   */
  status(parent: Agent, domain?: string): { workspace: string; binding?: Harness2Binding; revisions: { domain: string; mode: 'parallel' | 'sequential'; revision: number; runId: string; adoptedAt: number }[] } {
    this.assertLive(parent)
    const workspace = workspaceRoot(this.ctx.workingDirectory.get(parent.session))
    const binding = this.domain.table('bindings').get(workspace)
    const revisions = [...this.domain.table('revisions').entries()].map(([, value]) => value)
      .filter(record => this.revision(record.mode, record.domain, record.revision)?.runId === record.runId)
      .filter(record => domain === undefined || record.domain === domain.trim())
      .sort((a, b) => a.domain.localeCompare(b.domain, 'en') || a.mode.localeCompare(b.mode, 'en') || a.revision - b.revision)
      .map(({ domain: name, mode, revision, runId: id, adoptedAt }) => ({ domain: name, mode, revision, runId: id, adoptedAt }))
    return { workspace, ...binding === undefined ? {} : { binding }, revisions }
  }

  /**
   * Apply a selected patch to its originating workspace after user approval.
   * @param parent - Exact live originating parent in the original workspace.
   * @param id - Completed workspace preview.
   * @param options - Cancellation and originating tool call for approval audit.
   * @returns Whether files changed. If application is interrupted, inspect the workspace before retrying.
   */
  applyChanges(parent: Agent, id: Harness2RunId, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<boolean> {
    this.assertLive(parent)
    return this.track(this.applyPreview(parent, id, options))
  }

  private async applyPreview(parent: Agent, id: Harness2RunId, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<boolean> {
    const preview = this.domain.table('previews').get(id)
    if (preview === undefined || preview.parentSession !== parent.id || preview.executor !== 'workspace'
      || preview.workspace !== workspaceRoot(this.ctx.workingDirectory.get(parent.session))) {
      throw new Error('Harness² apply requires an originating-parent workspace preview in its original workspace')
    }
    const { contentHash, ...payload } = preview
    if (contentHash !== contentDigest(payload)) throw new Error('Harness² preview content hash mismatch')
    const patch = preview.finals.find(final => final.label === preview.selected)?.changes
    if (!patch) return false
    const signal = AbortSignal.any([options.signal, this.lifecycle.signal])
    const assertWritable = async () => {
      this.assertLive(parent)
      signal.throwIfAborted()
      const policy = this.ctx.get('sandboxPolicy')?.resolve({ session: parent.session })
      if (policy === undefined || policy.mode === 'read-only'
        || policy.mode === 'workspace-write' && policy.workspaceRoot !== preview.workspace) {
        throw new Error('Harness² cannot apply changes under the current workspace permissions')
      }
      if (preview.workspace !== workspaceRoot(this.ctx.workingDirectory.get(parent.session))
        || await realpath(preview.workspace) !== preview.workspace) {
        throw new Error('Harness² originating workspace changed; inspect it before applying')
      }
    }
    await assertWritable()
    const digest = createHash('sha256').update(patch).digest('hex')
    const approval = await this.ctx.approval.request({ agent: parent, signal, toolName: 'harness2_apply',
      ...options.callId === undefined ? {} : { callId: options.callId },
      reason: `Apply the selected Harness² patch ${digest} to ${preview.workspace}?\n\n${patch.slice(0, 8000)}` })
    if (approval !== 'allowed-once') throw new Error(`Harness² patch application was not approved (${approval}); files are unchanged`)
    await assertWritable()
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('Harness² patch application requires the subprocess service')
    const git = new WorkspaceGit(subprocess, await subprocess.resolveExecutable('git', undefined, signal), this.workspaceLimits())
    await git.checked(preview.workspace, ['apply', '--check', '--whitespace=nowarn', '-'], signal, patch)
    await assertWritable()
    await git.checked(preview.workspace, ['apply', '--whitespace=nowarn', '-'], signal, patch)
    return true
  }

  private revision(mode: 'parallel' | 'sequential', domain: string, value: number | undefined): RevisionRecord | undefined {
    const lesson = this.domain.table('lessons').get(libraryKey(mode, domain))
    const target = value ?? lesson?.revision
    if (target === undefined || lesson === undefined || target > lesson.revision) return undefined
    const stored = this.domain.table('revisions').get(revisionKey(mode, domain, target))
    if (stored !== undefined && (target < lesson.revision || stored.runId === lesson.runId)) return stored
    // Version 2 libraries kept only the current lesson; it remains bindable as its own revision.
    return lesson.revision === target
      ? { domain, mode, revision: target, runId: lesson.runId, candidate: lesson.candidate,
        instructions: lesson.instructions, reflection: lesson.reflection, adoptedAt: 0 }
      : undefined
  }

  private async installOverlay(agent: Agent): Promise<void> {
    if (agent.session.header.origin === 'subagent') return
    const pinned = this.overlayState.stateOf(agent.session)
    if (pinned !== null && 'disabled' in pinned) return
    const binding = pinned ?? this.domain.table('bindings').get(workspaceRoot(this.ctx.workingDirectory.get(agent.session)))
    if (binding === undefined) {
      agent.session.append('harness2/overlay', { disabled: true })
      return
    }
    const record = this.revision(binding.mode, binding.domain, binding.revision)
    if (record === undefined) {
      if (pinned !== null) throw new Error('Harness² recorded overlay revision is missing; restore it before resuming')
      this.ctx.logger.warn(`Harness² binding for ${binding.workspace} names missing revision ${binding.revision}`)
      agent.session.append('harness2/overlay', { disabled: true })
      return
    }
    let tree: CandidateTree
    try {
      tree = validateCandidateTree(record.candidate, {
        maxFiles: this.config.maxCandidateFiles, maxFileBytes: this.config.maxCandidateFileBytes,
        maxTotalBytes: this.config.maxCandidateBytes, maxAlwaysOnChars: this.config.maxInstructionsChars })
    } catch (error) {
      if (pinned !== null) {
        throw new Error('Harness² recorded overlay revision is invalid; restore it before resuming', { cause: error })
      }
      this.ctx.logger.warn(`Harness² bound revision is no longer valid: ${error instanceof Error ? error.message : String(error)}`)
      agent.session.append('harness2/overlay', { disabled: true })
      return
    }
    if (pinned !== null && candidateHash(tree) !== pinned.candidateHash) {
      throw new Error('Harness² recorded overlay candidate hash mismatch; restore the adopted revision before resuming')
    }
    const runtimeConfig = this.config.runtime
    const executable = new Set([...candidateCatalog(tree).scripts, ...candidateCatalog(tree).plugins])
    const omitted = runtimeConfig === null ? [...executable] : []
    const installed = omitted.length ? Object.fromEntries(Object.entries(tree).filter(([path]) => !executable.has(path))) : tree
    const text = overlayText(binding, installed, omitted)
    const systemPrompt = agent.ctx.systemPrompt
    if (text) {
      systemPrompt.section({ name: 'harness2:overlay', order: systemPrompt.getSectionOrder('HARNESS2_OVERLAY'), text, interpolate: false })
    }
    const skills = agent.ctx.get('skills')
    if (skills === undefined) throw new Error('Harness² workspace guidance requires the skill registry in this Agent scope')
    for (const skill of overlaySkills(installed)) skills.register({ ...skill, source: 'runtime', provider: 'harness2' })
    const authority: CandidateExecutionAuthority = {
      // The activation grant listed the deny-only middleware; helpers still need one grant per execution.
      approve: async (request, signal) => request.path.startsWith('plugin/') || await this.ctx.approval.request({ agent, signal, toolName: 'harness2_candidate_execute',
        reason: `Execute isolated adopted candidate ${request.hash} entry ${request.path} with exact JSON input:\n${request.input}` }) === 'allowed-once',
      audit: event => agent.session.append('harness2/execution', event),
    }
    const runtime = runtimeConfig === null ? undefined : 'backend' in runtimeConfig
      ? new WasiCandidateRuntime(runtimeConfig, authority) : new IsolatedCandidateRuntime(runtimeConfig, authority)
    await installCandidateResources(agent, installed, {
      ...runtime === undefined ? {} : { runtime }, signal: this.lifecycle.signal, nativeSkills: true,
      delegate: (path, instructions, task, signal) => this.overlayDelegate(agent, path, instructions, task, signal),
    })
    if (pinned === null) agent.session.append('harness2/overlay', { workspace: binding.workspace, domain: binding.domain, mode: binding.mode,
      revision: binding.revision, candidateHash: candidateHash(tree) })
  }

  /** Adopted delegates run as ordinary managed children under the parent's normal composition and policy. */
  private overlayDelegate(parent: Agent, path: string, instructions: string, task: string, signal: AbortSignal): Promise<string> {
    return this.track(this.runOverlayDelegate(parent, path, instructions, task, signal))
  }

  private async runOverlayDelegate(parent: Agent, path: string, instructions: string, task: string, signal: AbortSignal): Promise<string> {
    boundedText(task, 'delegated task', this.config.maxTaskChars)
    const childId = SessionId(`harness2-delegate-${randomUUID()}`)
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort(new Error('Harness² delegate timed out')) }, this.config.childTimeoutMs)
    const control = AbortSignal.any([signal, timeout.signal, this.lifecycle.signal])
    this.delegates.add(childId)
    try {
      const activation = await this.ctx.subagents.startActivation({
        provider: this.config.provider, childId, label: `Harness² ${path}`, signal: control, delivery: 'caller', oneShot: true,
        request: { parent, prompt: [{ type: 'text', text: `${instructions}\n\nTask:\n${task}` }], outputSchema: schema(['answer']),
          agentOptions: { maxTokens: Math.min(this.config.maxTokensPerChild, parent.options.maxTokens ?? this.config.maxTokensPerChild) } },
      })
      const result = await settleActivation(activation, control)
      if (result.stopReason !== 'completed') throw new Error(`Harness² delegate ${path} ended with ${result.stopReason}`)
      return boundedText(record(result.structured)['answer'], 'delegated answer', this.config.maxOutputChars)
    } finally {
      clearTimeout(timer)
      this.delegates.delete(childId)
    }
  }

  private limitSteps(agent: Agent): void {
    let admitted = 0
    agent.ctx.on('agent/pre-step', async (_payload, next) => {
      if (admitted >= this.config.maxStepsPerChild) return { kind: 'reject' }
      const decision = await next()
      if (decision.kind === 'enter') admitted += 1
      return decision
    })
  }

  private assertLive(parent: Agent): void {
    this.lifecycle.signal.throwIfAborted()
    if (this.ctx.agents.get(parent.id) !== parent) throw new Error('Harness² requires the exact live parent Agent')
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.active.add(operation)
    void operation.then(() => this.active.delete(operation), () => this.active.delete(operation))
    return operation
  }

  private async adopt(parent: Agent, preview: PreviewRecord, options: { signal: AbortSignal; callId?: ToolCallId }): Promise<number> {
    const lessons = this.domain.table('lessons')
    const key = libraryKey(preview.mode, preview.domain)
    const current = lessons.get(key)
    if (current?.runId === preview.runId) return current.revision
    const signal = AbortSignal.any([options.signal, this.lifecycle.signal])
    signal.throwIfAborted()
    const outcome = await this.ctx.approval.request({
      agent: parent, toolName: 'harness2_remember', signal,
      ...options.callId === undefined ? {} : { callId: options.callId },
      reason: `Save Harness² preview ${preview.runId} for future experiments in domain ${preview.domain}? This does not change the current conversation or its permissions.\n\nInstructions:\n${preview.instructions}\n\nReflection:\n${preview.reflection}`,
    })
    if (outcome !== 'allowed-once') throw new Error(`Harness² adoption was not approved (${outcome}); domain guidance is unchanged`)
    signal.throwIfAborted()
    if ((current?.revision ?? 0) !== preview.baseRevision) {
      throw new Error('Harness² domain guidance changed after this preview; run a fresh preview before adopting')
    }
    const revision = preview.baseRevision + 1
    parent.session.append('harness2/remember-request', { runId: runId(preview.runId), domain: preview.domain, revision })
    // History is written first: a lesson revision is never visible without its bindable candidate.
    await this.domain.table('revisions').put(revisionKey(preview.mode, preview.domain, revision), {
      domain: preview.domain, mode: preview.mode, revision, runId: preview.runId, candidate: preview.candidate,
      instructions: preview.instructions, reflection: preview.reflection, adoptedAt: Date.now(),
    })
    await lessons.put(key, {
      runId: preview.runId, revision, instructions: preview.instructions, reflection: preview.reflection, candidate: preview.candidate,
      entries: [...current?.entries ?? [], { runId: preview.runId, task: preview.task, candidate: preview.candidate,
        reflection: preview.reflection, selected: preview.selected,
        ...preview.lesson === undefined ? {} : { cue: preview.lesson.cue, evidence: preview.lesson.evidence, edits: preview.lesson.edits },
      }].slice(-this.config.maxLibraryEntries),
    })
    return revision
  }

  private async execute(request: Harness2Request, id: Harness2RunId, mode: 'parallel' | 'sequential', k: number): Promise<Harness2Result> {
    const execution = await this.prepareWorkspace(request)
    try {
      return await this.executeRun(request, id, mode, k, execution)
    } finally {
      await execution.workspace?.dispose()
    }
  }

  private async prepareWorkspace(request: Harness2Request): Promise<{ workspace?: RolloutWorkspace; reason?: string }> {
    if (this.config.rollout === 'read-only') return {}
    const subprocess = this.ctx.get('subprocess')
    const policy = this.ctx.get('sandboxPolicy')
    const fs = this.ctx.get('fs')
    const shellRequired = ['bash', 'pwsh'].some(name => request.parent.ctx.tools.get(name, request.parent) !== undefined)
    if (subprocess === undefined || policy === undefined || fs?.sandboxMode === undefined
      || shellRequired && this.ctx.get('shell')?.sandboxMode === undefined) {
      return { reason: 'Workspace rollouts require sandbox-enforcing filesystem and shell providers; used read-only execution.' }
    }
    if (policy.resolve({ session: request.parent.session }).additionalWritableRoots?.length) {
      return { reason: 'Workspace rollouts cannot inherit additional writable roots; used read-only execution.' }
    }
    const source = await realpath(this.ctx.workingDirectory.get(request.parent.session))
    const shared = relative(await realpath(tmpdir()), source)
    if (shared === '' || shared !== '..' && !shared.startsWith(`..${sep}`) && !isAbsolute(shared)) {
      return { reason: 'The source workspace is writable through the shared OS temporary grant; used read-only execution.' }
    }
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    const approved = await this.ctx.approval.request({ agent: request.parent, signal, toolName: 'harness2_workspace_rollouts',
      reason: `Run Harness² coding tools in independent workspace copies under ${this.config.scratchDirectory}? `
        + `Each child is limited to ${this.config.maxStepsPerChild} steps and ${this.config.maxRolloutTokens} reported tokens. `
        + 'Copies include current uncommitted files; selected changes are returned as a patch and require separate approval to apply.' })
    if (approved !== 'allowed-once') return { reason: `Workspace rollouts were not approved (${approved}); used read-only execution.` }
    const limits = this.workspaceLimits()
    const executable = await subprocess.resolveExecutable('git', undefined, signal)
    const git = new WorkspaceGit(subprocess, executable, limits)
    try {
      return { workspace: await RolloutWorkspace.capture(git, this.ctx.workingDirectory.get(request.parent.session), limits, signal) }
    } catch (error) {
      if (!(error instanceof WorkspaceFailure) || error.code === 'command') throw error
      return { reason: `${error.message}; used read-only execution.` }
    }
  }

  private workspaceLimits() {
    return { directory: this.config.scratchDirectory, maxBytes: this.config.maxScratchBytes,
      maxFiles: this.config.maxScratchFiles, maxDiffBytes: this.config.maxDiffBytes, timeoutMs: this.config.childTimeoutMs }
  }

  private async executeRun(request: Harness2Request, id: Harness2RunId, mode: 'parallel' | 'sequential', k: number,
    execution: { workspace?: RolloutWorkspace; reason?: string }): Promise<Harness2Result> {
    const workspace = execution.workspace
    const fileEditing = this.config.editor === 'filesystem' && this.ctx.get('fs')?.sandboxMode !== undefined
      && this.ctx.get('sandboxPolicy') !== undefined
    const editorAuthority = fileEditing
      ? await TaskToolAuthority.capture(request.parent, ['read', 'glob', 'grep', 'write', 'edit'], request.signal)
      : undefined
    const reviewAuthority = fileEditing
      ? await TaskToolAuthority.capture(request.parent, this.config.readTools, request.signal) : undefined
    const assembly = fileEditing
      ? await this.ctx.systemPrompt.assemble({ scope: request.parent, agent: request.parent, signal: request.signal }) : undefined
    const editorAgent: EditorInput['agent'] = {
      systemPrompt: assembly === undefined ? '' : renderPrompt(assembly), tools: assembly?.tools ?? [],
      skills: fileEditing
        ? await this.ctx.skills.list({ scope: request.parent, cwd: this.ctx.workingDirectory.get(request.parent.session) }) : [],
      cwd: this.ctx.workingDirectory.get(request.parent.session),
    }
    const authority = await TaskToolAuthority.capture(request.parent,
      workspace === undefined ? this.config.readTools : WORKSPACE_TASK_TOOLS,
      AbortSignal.any([request.signal, this.lifecycle.signal]))
    const fingerprint = createHash('sha256').update(JSON.stringify({ version: 3, task: request.task, domain: request.domain, mode, k,
      config: this.config, workspaceHash: workspace?.hash, cwd: this.ctx.workingDirectory.get(request.parent.session),
      model: request.parent.model.current(), options: request.parent.options })).digest('hex')
    const runs = this.domain.table('runs')
    let saved = runs.get(id)
    if (request.resumeRunId !== undefined) {
      if (saved === undefined || saved.parentSession !== request.parent.id || saved.fingerprint !== fingerprint) {
        throw new Error('Harness² resume requires the same parent, task, domain, mode, k, and deployment configuration')
      }
      const completed = this.domain.table('previews').get(id)
      if (completed !== undefined) {
        const { contentHash, ...payload } = completed
        if (contentHash !== contentDigest(payload)) throw new Error('Harness² completed preview content hash mismatch')
        return {
          runId: id, domain: completed.domain, answer: completed.answer, instructions: completed.instructions,
          reflection: completed.reflection, candidate: completed.candidate, mode: completed.mode, k: completed.k,
          selected: completed.selected, finals: completed.finals,
          ...completed.executor === undefined ? {} : { executor: completed.executor },
          ...completed.workspace === undefined ? {} : { workspace: completed.workspace },
          ...completed.executorReason === undefined ? {} : { executorReason: completed.executorReason },
          ...completed.usage === undefined ? {} : { usage: completed.usage },
          ...completed.editor === undefined ? {} : { editor: completed.editor },
          ...completed.lesson === undefined ? {} : { lesson: completed.lesson },
          ...completed.selectionFallback === undefined ? {} : { selectionFallback: completed.selectionFallback },
          stages: completed.stages.map(stage => ({ ...stage, sessionId: SessionId(stage.sessionId) })),
        }
      }
    } else {
      const lesson = this.domain.table('lessons').get(libraryKey(mode, request.domain))
      saved = {
        runId: id, parentSession: request.parent.id, fingerprint, domain: request.domain,
        baseRevision: lesson?.revision ?? 0, candidate: this.config.baseCandidate,
        reflection: lesson?.reflection ?? '', library: lesson?.entries ?? [], createdAt: Date.now(),
      }
      const initial = saved
      const admission = this.previewCommit.then(async () => {
        const stale = [...runs.entries()].filter(([key]) => !this.runningIds.has(key))
          .sort((a, b) => a[1].createdAt - b[1].createdAt)
          .slice(0, Math.max(0, runs.size - this.config.maxSavedRuns + 1)).map(([key]) => key)
        const obsolete = new Set(stale)
        await this.domain.table('checkpoints').deleteMany([...this.domain.table('checkpoints').entries()]
          .filter(([, value]) => obsolete.has(value.runId)).map(([key]) => key))
        await this.domain.table('previews').deleteMany(stale)
        await runs.deleteMany(stale)
        await runs.put(id, initial)
      })
      this.previewCommit = admission.then(() => undefined, () => undefined)
      await admission
    }
    const baseRevision = saved.baseRevision
    const stages: Harness2Stage[] = []
    const usage = { inputTokens: 0, outputTokens: 0 }
    const recordUsage = (output: Record<string, unknown>) => {
      if (output['usage'] === undefined) return
      const reported = usageSchema.parse(output['usage'])
      usage.inputTokens += reported.inputTokens
      usage.outputTokens += reported.outputTokens
    }
    const stageOrder = new Map<string, number>()
    const orderStages = () => stages.sort((a, b) => (stageOrder.get(a.label ?? '') ?? 0) - (stageOrder.get(b.label ?? '') ?? 0))
    const signal = AbortSignal.any([request.signal, this.lifecycle.signal])
    request.parent.session.append('harness2/start', { runId: id, domain: request.domain, baseRevision })
    const call = async (label: string, phase: Harness2Stage['phase'], mission: string, evidence: object, fields: readonly string[],
      candidate?: CandidateTree, choices?: readonly string[], editor?: EditorWorkspace) => {
      signal.throwIfAborted()
      if (!stageOrder.has(label)) stageOrder.set(label, stageOrder.size)
      const key = `${id}:${label}`
      const validateOutput = (output: Record<string, unknown>) => {
        if (typeof output['rolloutError'] === 'string') return
        if (fields.includes('answer')) boundedText(output['answer'], 'answer', this.config.maxOutputChars)
        if (phase === 'reflect') {
          boundedText(output['lesson'], 'reflection', this.config.maxReflectionChars)
          if (fields.includes('cue')) {
            for (const field of ['cue', 'evidence', 'edits']) boundedText(output[field], field, this.config.maxReflectionChars)
            const edits: unknown = JSON.parse(String(output['edits']))
            if (!Array.isArray(edits)) throw new TypeError('Harness² experience edits must be a JSON array')
          }
        }
        if (phase === 'select') {
          if (!choices?.includes(String(output['choice']))) {
            throw new TypeError('Harness² selector returned an unknown final answer id')
          }
          boundedText(output['rationale'], 'selection rationale', this.config.maxReflectionChars)
        }
      }
      const checkpoint = this.domain.table('checkpoints').get(key)
      if (checkpoint !== undefined) {
        const { contentHash, ...payload } = checkpoint
        if (contentHash !== contentDigest(payload)) throw new Error('Harness² checkpoint content hash mismatch')
        validateOutput(checkpoint.output)
        recordUsage(checkpoint.output)
        stages.push(...checkpoint.stages.map(stage => ({ ...stage, label, sessionId: SessionId(stage.sessionId) })))
        return checkpoint.output
      }
      const workspaceChild = workspace !== undefined && candidate !== undefined
      const fitted = editor === undefined ? fitEvidence(evidence, value => childPrompt(request.task, mission, value, workspaceChild).length,
        this.config.maxEvidenceChars).evidence : {}
      const prompt = editor === undefined ? childPrompt(request.task, mission, fitted, workspaceChild)
        : `Read context/task.md for the task and context/evidence.json for the stage evidence.\n\n${mission}`
      boundedText(prompt, 'complete child message', this.config.maxEvidenceChars)
      const local: Harness2Stage[] = []
      let output: Record<string, unknown>
      let recordedUsage = false
      try {
        const checkout = candidate === undefined || workspace === undefined ? undefined : await workspace.checkout(signal)
        output = await this.child(request.parent, phase, prompt, fields, signal, local, candidate,
          editor === undefined ? authority : phase === 'select' || phase === 'reflect' ? reviewAuthority : editorAuthority,
          editor?.cwd ?? checkout?.cwd, editor)
        recordUsage(output)
        recordedUsage = true
        if (editor !== undefined && fields.includes('notes')) {
          output['tree'] = JSON.stringify(await editor.candidate())
          output['rationale'] = output['notes']
        }
        if (checkout !== undefined && workspace !== undefined) {
          try { output['changes'] = await workspace.changes(checkout, signal) } catch (error) {
            if (!(error instanceof WorkspaceFailure)) throw error
            output['rolloutError'] = error.message
          }
        }
      } catch (error) {
        if (signal.aborted || !(error instanceof ChildExecutionFailure)) throw error
        if (fields.includes('answer')) output = { rolloutError: error.message,
          ...error.evidence === undefined ? {} : { executionEvidence: error.evidence },
          ...error.usage === undefined ? {} : { usage: error.usage } }
        else if (fields.includes('tree') || fields.includes('notes')) output = { proposalError: error.message,
          ...error.usage === undefined ? {} : { usage: error.usage } }
        else throw error
      } finally {
        stages.push(...local.map(stage => ({ ...stage, label })))
      }
      if (!recordedUsage) recordUsage(output)
      const sessionId = local[0]?.sessionId
      if (sessionId === undefined) {
        if (typeof output['rolloutError'] === 'string' || typeof output['proposalError'] === 'string') return output
        throw new Error('Harness² child completed without evidence session')
      }
      try {
        validateOutput(output)
      } catch (error) {
        if (!fields.includes('answer') || !(error instanceof TypeError)) throw error
        output = { rolloutError: error.message,
          ...typeof output['executionEvidence'] === 'string' ? { executionEvidence: output['executionEvidence'] } : {},
          ...output['usage'] === undefined ? {} : { usage: output['usage'] } }
      }
      const payload = { runId: id, label, phase, sessionId, stages: local, output }
      await this.domain.table('checkpoints').put(key, { ...payload, contentHash: contentDigest(payload) })
      return output
    }
    const limits = {
      maxFiles: this.config.maxCandidateFiles, maxFileBytes: this.config.maxCandidateFileBytes,
      maxTotalBytes: this.config.maxCandidateBytes, maxAlwaysOnChars: this.config.maxInstructionsChars,
    }
    let result: Harness2Result
    try {
      const base = validateCandidateTree(saved.candidate, limits)
      const recursion = await runSchedule(mode, k, base, {
        rollout: async (label, candidate) => {
          const phase = label.startsWith('base') ? 'baseline' : label.startsWith('inv') ? 'invariant-probe' : label.startsWith('dom') ? 'domain-probe' : 'final'
          const mission = workspace === undefined ? SOLVE_MISSION : WORKSPACE_SOLVE_MISSION
          const output = await call(`rollout:${label}`, phase, mission,
            { resources: candidateCatalog(candidate), instructions: candidateInstructions(candidate) }, ['answer'], candidate)
          if (typeof output['rolloutError'] === 'string') return { label, candidate, answer: '', error: output['rolloutError'], trajectory: typeof output['executionEvidence'] === 'string' ? output['executionEvidence'] : '' }
          return { label, candidate, answer: boundedText(output['answer'], 'answer', this.config.maxOutputChars),
            ...typeof output['changes'] === 'string' ? { changes: output['changes'] } : {},
            trajectory: typeof output['executionEvidence'] === 'string' ? output['executionEvidence'] : '' }
        },
        improve: async (label, dimension, evidence) => {
          stageOrder.set(`improve:${label}:1`, stageOrder.size)
          stageOrder.set(`improve:${label}:2`, stageOrder.size)
          const mission = dimension === 'invariant' ? INVARIANT_MISSION : dimension === 'domain' ? DOMAIN_MISSION : COMPOSE_MISSION
          let rejection = ''
          for (let attempt = 1; attempt <= 2; attempt++) {
            if (fileEditing) {
              const editor = await EditorWorkspace.create(this.config.scratchDirectory, { task: request.task, current: evidence.current,
                evidence: { ...evidence, domain: request.domain, rejection }, library: saved.library, agent: editorAgent },
              limits, this.config.maxScratchBytes)
              try {
                const index = Number(label.replace(/\D/g, ''))
                const assignment = dimension === 'compose'
                  ? mode === 'sequential' ? composeRoundPrompt({ t: index, k }) : aggregatePrompt({ k, index })
                  : proposePrompt(dimension === 'invariant' ? 'INV' : 'DOM', { k, index, ...mode === 'sequential' ? { round: index } : {} })
                const output = await call(`improve:${label}:${attempt}`, dimension, assignment, {}, ['notes'], undefined, undefined, editor)
                if (typeof output['proposalError'] === 'string') throw new TypeError(output['proposalError'])
                const candidate = validateCandidateTree(JSON.parse(String(output['tree'])), limits)
                const rationale = boundedText(output['rationale'], 'rationale', this.config.maxReflectionChars)
                return { candidate, rationale, attempts: attempt, inherited: candidateHash(candidate) === candidateHash(evidence.current) }
              } catch (error) {
                if (!(error instanceof TypeError || error instanceof SyntaxError)) throw error
                rejection = error.message.slice(0, this.config.maxReflectionChars)
              } finally { await editor.dispose() }
              continue
            }
            const assignment = `${mission}\n${TREE_MISSION}`
            // Current-run evidence is clipped only as far as needed for the message to fit without history.
            const current = fitEvidence({ ...evidence, domain: request.domain, rejection }, value => childPrompt(request.task, assignment, {
              ...value, library: [], priorReflection: '', libraryOmitted: saved.library.length, priorReflectionOmitted: saved.reflection !== '',
            }).length, this.config.maxEvidenceChars).evidence
            const history = libraryEvidence(request.task, assignment, current,
              saved.library, saved.reflection, this.config.maxEvidenceChars)
            const output = await call(`improve:${label}:${attempt}`, dimension, assignment, history, ['tree', 'rationale'])
            try {
              if (typeof output['proposalError'] === 'string') throw new TypeError(output['proposalError'])
              const raw = boundedText(output['tree'], 'tree', this.config.maxCandidateBytes * 6)
              const candidate = validateCandidateTree(JSON.parse(raw), limits)
              const rationale = boundedText(output['rationale'], 'rationale', this.config.maxReflectionChars)
              return { candidate, rationale, attempts: attempt, inherited: candidateHash(candidate) === candidateHash(evidence.current) }
            } catch (error) {
              if (!(error instanceof TypeError || error instanceof SyntaxError || error instanceof Error && error.name === 'CandidateValidationError')) throw error
              rejection = error.message.slice(0, this.config.maxReflectionChars)
            }
          }
          return { candidate: evidence.current, rationale: `Invalid proposal; inherited current candidate: ${rejection}`, attempts: 2, inherited: true }
        },
      })
      const delivered = recursion.finals.filter(final => final.error === undefined)
      let selected = delivered[0]
      if (selected === undefined) throw new Error('Harness² recursion produced no delivered final candidates')
      let selectionFallback: string | undefined
      if (k > 1 && delivered.length > 1) {
        const alternatives = delivered.map((final, index) => ({ id: `answer-${index + 1}`, answer: final.answer, changes: final.changes }))
        try {
          const context = fileEditing ? await EditorWorkspace.create(this.config.scratchDirectory, { task: request.task, current: base,
            evidence: { alternatives }, library: [], agent: editorAgent }, limits, this.config.maxScratchBytes) : undefined
          let selection: Record<string, unknown>
          try {
            selection = await call('select', 'select', fileEditing ? selectPrompt(alternatives.length) : SELECT_MISSION,
              { alternatives }, ['choice', 'rationale'], undefined, alternatives.map(alternative => alternative.id), context)
          } finally { await context?.dispose() }
          const choice = delivered[alternatives.findIndex(alternative => alternative.id === selection['choice'])]
          if (choice === undefined) throw new TypeError('Harness² selector returned an unknown final answer id')
          selected = choice
        } catch (error) {
          // A selector failure never discards delivered work; the first delivered final is a neutral stand-in.
          if (signal.aborted || !(error instanceof TypeError || error instanceof ChildExecutionFailure)) throw error
          selectionFallback = error.message.slice(0, this.config.maxReflectionChars)
        }
      }
      const context = fileEditing ? await EditorWorkspace.create(this.config.scratchDirectory, {
        task: request.task, current: selected.candidate, evidence: { ...recursion, selected: selected.label },
        library: saved.library, agent: editorAgent }, limits, this.config.maxScratchBytes) : undefined
      let reflected: Record<string, unknown>
      try {
        reflected = await call('reflect', 'reflect', fileEditing ? `${experiencePrompt()}\nReturn cue, lesson, evidence, and edits as strings.` : REFLECT_MISSION,
          { ...recursion, selected: selected.label }, fileEditing ? ['cue', 'lesson', 'evidence', 'edits'] : ['lesson'], undefined, undefined, context)
      } finally { await context?.dispose() }
      const reflection = boundedText(reflected['lesson'], 'reflection', this.config.maxReflectionChars)
      signal.throwIfAborted()
      orderStages()
      result = { runId: id, domain: request.domain, mode, k, selected: selected.label, finals: recursion.finals,
        executor: workspace === undefined ? 'read-only' : 'workspace',
        usage,
        editor: fileEditing ? 'filesystem' : 'json',
        ...fileEditing ? { lesson: { cue: String(reflected['cue']), lesson: String(reflected['lesson']),
          evidence: String(reflected['evidence']), edits: String(reflected['edits']) } } : {},
        ...workspace === undefined ? {} : { workspace: workspace.root },
        ...execution.reason === undefined ? {} : { executorReason: execution.reason },
        ...selectionFallback === undefined ? {} : { selectionFallback },
        answer: selected.answer, candidate: selected.candidate,
        instructions: candidateInstructions(selected.candidate), reflection, stages }
    } catch (error) {
      orderStages()
      request.parent.session.append('harness2/end', { runId: id, status: 'failed', childSessions: stages.map(stage => stage.sessionId) })
      throw new Error(`Harness² run ${id} stopped: ${error instanceof Error ? error.message : String(error)}; completed checkpoints are retained. Resume unfinished stages with the same settings; start a new run to retry failed rollouts.`, { cause: error })
    }
    request.parent.session.append('harness2/end', { runId: id, status: 'computed', childSessions: stages.map(stage => stage.sessionId) })
    const commit = this.previewCommit.then(async () => {
      signal.throwIfAborted()
      const previews = this.domain.table('previews')
      const stale = [...previews.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, Math.max(0, previews.size - this.config.maxSavedRuns + 1)).map(([key]) => key)
      const obsolete = new Set(stale)
      await this.domain.table('checkpoints').deleteMany([...this.domain.table('checkpoints').entries()]
        .filter(([, value]) => obsolete.has(value.runId)).map(([key]) => key))
      await previews.deleteMany(stale)
      await runs.deleteMany(stale)
      signal.throwIfAborted()
      const payload = { ...result, finals: result.finals.map(final => ({ ...final })),
        stages: [...stages], parentSession: request.parent.id,
        task: request.task, baseRevision, createdAt: Date.now() }
      await previews.put(id, { ...payload, contentHash: contentDigest(payload) })
    })
    this.previewCommit = commit.then(() => undefined, () => undefined)
    await commit
    return result
  }

  private async acquireChildSlot(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    while (this.childSlots >= this.config.maxConcurrentChildren) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.slotWaiters.delete(wake); signal.removeEventListener('abort', abort) }
        const wake = () => { cleanup(); resolve() }
        const abort = () => { cleanup(); reject(signal.reason instanceof Error ? signal.reason : new Error('Harness² child admission aborted', { cause: signal.reason })) }
        this.slotWaiters.add(wake)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
      signal.throwIfAborted()
    }
    this.childSlots += 1
    return () => {
      this.childSlots -= 1
      for (const wake of [...this.slotWaiters]) wake()
    }
  }

  private async child(
    parent: Agent, phase: Harness2Stage['phase'], prompt: string, fields: readonly string[],
    signal: AbortSignal, stages: Harness2Stage[], candidate?: CandidateTree, authority?: TaskToolAuthority, cwd?: string,
    editor?: EditorWorkspace,
  ): Promise<Record<string, unknown>> {
    const childId = SessionId(`harness2-${randomUUID()}`)
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort(new ChildExecutionFailure(`Harness² ${phase} timed out`)) }, this.config.childTimeoutMs)
    const inherited = this.pending.get(parent.id)
    const budget = inherited?.budget ?? { inputTokens: 0, outputTokens: 0, control: new AbortController() }
    const childSignal = AbortSignal.any([signal, timeout.signal, budget.control.signal])
    const parentTrace = this.pending.get(parent.id)?.trace
    const trace = parentTrace ?? (candidate === undefined ? undefined : createTrace(this.config.maxTrajectoryChars))
    let release = () => {}
    try {
      release = this.pending.has(parent.id) ? () => {} : await this.acquireChildSlot(childSignal)
      const taskAuthority = authority ?? inherited?.authority
      if (taskAuthority === undefined) throw new Error('Harness² child is missing its initiating parent authority')
      this.pending.set(childId, { authority: taskAuthority, task: candidate !== undefined || inherited?.task === true,
        candidate, signal: childSignal, stages, trace, workspace: cwd !== undefined || inherited?.workspace === true, budget,
        editor, tools: editor !== undefined })
      childSignal.throwIfAborted()
      const maxDepth = this.ctx.subagents.resolveMaxDepth()
      const activation = await this.ctx.subagents.startActivation({
        provider: this.config.provider, childId, label: `Harness² ${phase}`, signal: childSignal, delivery: 'caller', oneShot: true,
        request: {
          parent, prompt: [{ type: 'text', text: prompt }], outputSchema: schema(fields),
          ...cwd === undefined ? {} : { cwd },
          ...maxDepth === undefined ? {} : { maxDepth },
          agentOptions: { maxTokens: Math.min(this.config.maxTokensPerChild, parent.options.maxTokens ?? this.config.maxTokensPerChild) },
        },
      })
      stages.push({ phase, sessionId: childId })
      const result = await settleActivation(activation, childSignal)
      childSignal.throwIfAborted()
      if (result.stopReason !== 'completed') throw new ChildExecutionFailure(`Harness² ${phase} ended with ${result.stopReason}`)
      let output: Record<string, unknown>
      try {
        output = record(result.structured)
      } catch (error) {
        throw new ChildExecutionFailure('Harness² child returned invalid structured output', { cause: error })
      }
      return { ...output, usage: { inputTokens: budget.inputTokens, outputTokens: budget.outputTokens },
        ...trace === undefined ? {} : { executionEvidence: renderTrace(trace) } }
    } catch (error) {
      // Nested delegates share the rollout trace; only the owning rollout reports it.
      if (error instanceof ChildExecutionFailure && trace !== undefined && parentTrace === undefined) error.evidence ??= renderTrace(trace)
      if (error instanceof ChildExecutionFailure) error.usage ??= { inputTokens: budget.inputTokens, outputTokens: budget.outputTokens }
      throw error
    } finally {
      clearTimeout(timer)
      this.pending.delete(childId)
      release()
    }
  }
}

export default Harness2Engine
