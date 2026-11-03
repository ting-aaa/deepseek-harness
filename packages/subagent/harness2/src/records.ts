/** Validated persistent previews and explicitly adopted domain guidance. @module */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const stage = z.object({
  phase: z.enum(['baseline', 'invariant', 'domain', 'invariant-probe', 'domain-probe', 'compose', 'final', 'reflect', 'select']),
  sessionId: z.string(), label: z.string().optional(),
}).strict()

const tree = z.record(z.string(), z.string())
/** Provider-reported usage; absent reports contribute zero reported tokens. */
export const usageSchema = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict()
const reflection = z.object({ cue: z.string(), lesson: z.string(), evidence: z.string(), edits: z.string() }).strict()

const preview = z.object({
  contentHash: z.string(), runId: z.string(), parentSession: z.string(), domain: z.string(), task: z.string(),
  baseRevision: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(),
  answer: z.string(), instructions: z.string(), reflection: z.string(), stages: z.array(stage),
  candidate: tree, mode: z.enum(['parallel', 'sequential']), k: z.number().int().positive(),
  executor: z.enum(['workspace', 'read-only']).optional(), executorReason: z.string().optional(), workspace: z.string().optional(),
  usage: usageSchema.optional(),
  editor: z.enum(['filesystem', 'json']).optional(), lesson: reflection.optional(),
  selected: z.string(), selectionFallback: z.string().optional(), finals: z.array(z.object({
    label: z.string(), answer: z.string(), candidate: tree, error: z.string().optional(), trajectory: z.string().optional(),
    changes: z.string().optional(),
  }).strict()),
}).strict()

const experience = z.object({
  runId: z.string(), task: z.string(), candidate: tree, reflection: z.string(), selected: z.string(),
  cue: z.string().optional(), evidence: z.string().optional(), edits: z.string().optional(),
}).strict()

const lesson = z.object({
  runId: z.string(), revision: z.number().int().positive(),
  instructions: z.string(), reflection: z.string(), candidate: tree, entries: z.array(experience),
}).strict()

const run = z.object({
  runId: z.string(), parentSession: z.string(), fingerprint: z.string(),
  domain: z.string(), baseRevision: z.number().int().nonnegative(),
  candidate: tree, reflection: z.string(), library: z.array(experience), createdAt: z.number().int().nonnegative(),
}).strict()

const checkpoint = z.object({
  runId: z.string(), label: z.string(), phase: stage.shape.phase,
  contentHash: z.string(), sessionId: z.string(), stages: z.array(stage), output: z.record(z.string(), z.unknown()),
}).strict()

const mode = z.enum(['parallel', 'sequential'])

const revision = z.object({
  domain: z.string(), mode, revision: z.number().int().positive(), runId: z.string(),
  candidate: tree, instructions: z.string(), reflection: z.string(), adoptedAt: z.number().int().nonnegative(),
}).strict()

const binding = z.object({
  workspace: z.string(), domain: z.string(), mode, revision: z.number().int().positive(), boundAt: z.number().int().nonnegative(),
}).strict()

/** Plugin-owned library; version 4 admits version 2/3 rows and retains optional workspace artifacts and structured experience. */
export const librarySpec = defineDomain({
  name: 'harness2', version: 4, compatibleVersions: [2, 3],
  tables: {
    previews: domainTable(preview), lessons: domainTable(lesson), runs: domainTable(run), checkpoints: domainTable(checkpoint),
    revisions: domainTable(revision), bindings: domainTable(binding),
  },
})

/** Library key for one recursion mode and domain.
 * @param mode - Recursion mode.
 * @param domain - Caller-selected domain.
 * @returns The mode-specific library key.
 */
export function libraryKey(mode: 'parallel' | 'sequential', domain: string): string {
  return `${mode}:${domain}`
}

/** Revision-history key for one adopted candidate.
 * @param mode - Recursion mode.
 * @param domain - Caller-selected domain.
 * @param value - Accepted revision number.
 * @returns The revision-history key.
 */
export function revisionKey(mode: 'parallel' | 'sequential', domain: string, value: number): string {
  return `${libraryKey(mode, domain)}:${value}`
}

/** One explicitly adopted candidate revision, retained for later binding and rollback. */
export type RevisionRecord = z.infer<typeof revision>

/** Persisted successful run, owned by its originating parent Session. */
export type PreviewRecord = z.infer<typeof preview>
