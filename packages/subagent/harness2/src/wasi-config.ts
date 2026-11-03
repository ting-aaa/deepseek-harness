/** Portable interpreter budgets and private worker messages. @module */
import type { CandidateTree } from './candidate.ts'

/** Deployment-owned portable execution limits; omitted values use the built-in budgets. */
export interface WasiRuntimeConfig {
  /** Portable WebAssembly interpreter backend. */
  backend: 'wasi'
  /** Wall-clock execution deadline, including worker startup and interpreter compilation. */
  timeoutMs?: number
  /** Maximum UTF-8 JSON request bytes. */
  maxInputBytes?: number
  /** Maximum combined standard-stream and serialized result bytes. */
  maxOutputBytes?: number
  /** Maximum guest WebAssembly linear-memory bytes; excludes trusted host/runtime overhead. */
  memoryBytes?: number
  /** Independent byte ceiling for each in-memory /work and /tmp filesystem. */
  workspaceBytes?: number
  /** Directory and file entry ceiling per writable virtual filesystem. */
  maxWorkspaceEntries?: number
  /** Conservative CPU allowance, enforced by an equal or shorter wall-clock deadline. */
  cpuSeconds?: number
  /** Maximum number of exported regular files. */
  maxArtifactFiles?: number
  /** Maximum total decoded artifact bytes. */
  maxArtifactBytes?: number
}

/** Resolved budgets are immutable for one worker invocation. */
export type WasiRuntimeLimits = Required<WasiRuntimeConfig>

/** Portable defaults require no OS-specific runtime installation. */
export const WASI_DEFAULTS: WasiRuntimeLimits = {
  backend: 'wasi', timeoutMs: 30_000, maxInputBytes: 128_000, maxOutputBytes: 2_000_000,
  memoryBytes: 256 * 1024 * 1024, workspaceBytes: 16 * 1024 * 1024,
  maxWorkspaceEntries: 1024, cpuSeconds: 30, maxArtifactFiles: 64, maxArtifactBytes: 1_000_000,
}

/** One private worker invocation; contains no credentials or ambient environment. */
export interface WasiWorkerRequest {
  readonly tree: CandidateTree
  readonly path: string
  readonly input: string
  readonly limits: WasiRuntimeLimits
  readonly pythonArchive?: Uint8Array
}

/** Worker settlement is delivered only after all output has been bounded. */
export type WasiWorkerResult = { kind: 'completed'; output: unknown }
  | { kind: 'failed'; message: string }
