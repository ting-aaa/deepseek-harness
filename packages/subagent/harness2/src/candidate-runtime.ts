/** Finite generated-code execution shared by native and portable backends. @module */
import type { CandidateTree } from './candidate.ts'

/** A host-owned executor; generated candidates cannot change its configuration. */
export interface CandidateRuntime {
  /** Verify runtime availability without executing generated code. */
  preflight(signal: AbortSignal): Promise<void>
  /** Execute an approved entry and return a bounded JSON value and artifact envelope. */
  run(tree: CandidateTree, path: string, input: string, signal: AbortSignal): Promise<unknown>
}
