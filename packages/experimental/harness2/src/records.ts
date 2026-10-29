/** Validated persistent previews and explicitly adopted domain guidance. @module */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const stage = z.object({
  phase: z.enum(['baseline', 'invariant', 'domain', 'invariant-probe', 'domain-probe', 'compose', 'final', 'reflect', 'select']),
  sessionId: z.string(), label: z.string().optional(),
}).strict()

const tree = z.record(z.string(), z.string())

const preview = z.object({
  contentHash: z.string(), runId: z.string(), parentSession: z.string(), domain: z.string(), task: z.string(),
  baseRevision: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(),
  answer: z.string(), instructions: z.string(), reflection: z.string(), stages: z.array(stage),
  candidate: tree, mode: z.enum(['parallel', 'sequential']), k: z.number().int().positive(),
  selected: z.string(), finals: z.array(z.object({
    label: z.string(), answer: z.string(), candidate: tree, error: z.string().optional(), trajectory: z.string().optional(),
  }).strict()),
}).strict()

const experience = z.object({
  runId: z.string(), task: z.string(), candidate: tree, reflection: z.string(), selected: z.string(),
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

/** The library is plugin-owned state, separate from released Session data. */
export const librarySpec = defineDomain({
  name: 'harness2', version: 2,
  tables: { previews: domainTable(preview), lessons: domainTable(lesson), runs: domainTable(run), checkpoints: domainTable(checkpoint) },
})

/** Persisted successful run, owned by its originating parent Session. */
export type PreviewRecord = z.infer<typeof preview>
