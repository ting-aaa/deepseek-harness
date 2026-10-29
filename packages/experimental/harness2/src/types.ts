/** Native Harness² requests, results, and experimental audit records. @module */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CandidateTree } from './candidate.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Identifies one preview, independently of its child Sessions. */
export type Harness2RunId = Branded<'Harness2RunId'>

/** A bounded preview; only task text and explicitly remembered domain guidance cross into children. */
export interface Harness2Request {
  readonly parent: Agent
  readonly task: string
  readonly domain: string
  readonly signal: AbortSignal
  readonly mode?: 'parallel' | 'sequential'
  readonly k?: number
  readonly resumeRunId?: Harness2RunId
}

/** One child execution, including retries, selection and reflection. */
export interface Harness2Stage {
  readonly phase: 'baseline' | 'invariant' | 'domain' | 'invariant-probe' | 'domain-probe' | 'compose' | 'final' | 'reflect' | 'select'
  readonly sessionId: SessionId
  readonly label?: string | undefined
}

/** Completed preview, not a certification that the answer is correct. */
export interface Harness2Result {
  readonly runId: Harness2RunId
  readonly domain: string
  readonly answer: string
  readonly instructions: string
  readonly reflection: string
  readonly candidate: CandidateTree
  readonly mode: 'parallel' | 'sequential'
  readonly k: number
  readonly selected: string
  readonly finals: readonly {
    label: string
    answer: string
    candidate: CandidateTree
    error?: string | undefined
    trajectory?: string | undefined
  }[]
  readonly stages: readonly Harness2Stage[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** A preview started; child Sessions contain the exact model-visible requests and results. */
    'plugin:harness2/start': { runId: Harness2RunId; domain: string; baseRevision: number }
    /** Child computation settled; computed precedes the separately authoritative preview-storage commit. */
    'plugin:harness2/end': { runId: Harness2RunId; status: 'computed' | 'failed'; childSessions: SessionId[] }
    /** Isolated generated code is audited before execution and at its terminal result. */
    'plugin:harness2/execution': { hash: string; path: string; status: 'start' | 'completed' | 'failed'; detail: string }
    /** Adoption was requested; the domain library, not this intent record, owns committed acceptance. */
    'plugin:harness2/remember-request': { runId: Harness2RunId; domain: string; revision: number }
  }
}
