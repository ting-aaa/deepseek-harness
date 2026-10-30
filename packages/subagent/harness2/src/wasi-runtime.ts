/** Portable, finite candidate execution in owned WebAssembly workers. @module */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { PYTHON_WASI_ASSET as asset } from './runtime-assets.ts'
import { candidateCatalog, candidateHash } from './candidate.ts'
import type { CandidateTree } from './candidate.ts'
import type { CandidateRuntime } from './candidate-runtime.ts'
import type { CandidateExecutionAuthority } from './isolated-runtime.ts'
import { WASI_DEFAULTS } from './wasi-config.ts'
import type { WasiRuntimeConfig, WasiRuntimeLimits, WasiWorkerRequest, WasiWorkerResult } from './wasi-config.ts'

/** Structured terminal failure; the caller owns presentation and any retry decision. */
export class WasiCandidateError extends Error {
  constructor(readonly code: 'unavailable' | 'timeout' | 'aborted' | 'execution', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WasiCandidateError'
  }
}

/** Generated code receives virtual files and JSON only, with no ambient host APIs. */
export class WasiCandidateRuntime implements CandidateRuntime {
  private readonly limits: WasiRuntimeLimits
  private archive: Promise<Uint8Array> | undefined

  constructor(config: WasiRuntimeConfig, private readonly authority: CandidateExecutionAuthority) {
    this.limits = Object.freeze({ ...WASI_DEFAULTS, ...config })
    for (const [name, value] of Object.entries(this.limits)) {
      if (name !== 'backend' && (!Number.isSafeInteger(value) || Number(value) < 1)) throw new TypeError(`Invalid WASI runtime limit: ${name}`)
    }
    if (this.limits.memoryBytes < 32 * 1024 * 1024 || this.limits.memoryBytes > 4 * 1024 * 1024 * 1024) {
      throw new RangeError('WASI memoryBytes must be between 32 MiB and 4 GiB')
    }
  }

  /**
   * Verify the shipped interpreter archive without running candidate code or downloading files.
   * @param signal - Cancellation of runtime admission.
   * @returns Resolves when the pinned runtime bytes are available and valid.
   */
  async preflight(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.archiveBytes()
    signal.throwIfAborted()
  }

  private archiveBytes(): Promise<Uint8Array> {
    this.archive ??= readFile(new URL(`../assets/${asset.name}`, import.meta.url)).then((bytes) => {
      if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
        throw new WasiCandidateError('unavailable', 'Harness² Python runtime integrity check failed; rebuild or reinstall the application')
      }
      return bytes
    }, (cause: unknown) => {
      throw new WasiCandidateError('unavailable', 'Harness² Python runtime is missing; rebuild or reinstall the application', { cause })
    })
    return this.archive
  }

  /**
   * Execute an approved Python helper or TypeScript middleware in a fresh finite worker.
   * @param tree - Validated immutable candidate files.
   * @param path - Exact executable entry in the candidate catalog.
   * @param input - Bounded JSON input; never an operating-system command.
   * @param signal - Cancellation terminates and joins the owned worker before rejection.
   * @returns Bounded JSON value and regular-file artifacts from the private virtual workspace.
   */
  async run(tree: CandidateTree, path: string, input: string, signal: AbortSignal): Promise<unknown> {
    const catalog = candidateCatalog(tree)
    if (!catalog.scripts.includes(path) && !catalog.plugins.includes(path)) throw new TypeError('Unknown candidate executable entry')
    if (!catalog.plugins.includes(path) && !path.endsWith('.py')) throw new TypeError('Candidate scripts must be Python')
    if (Buffer.byteLength(input) > this.limits.maxInputBytes) throw new RangeError('Candidate input exceeds byte limit')
    JSON.parse(input)
    await this.preflight(signal)
    const hash = candidateHash(tree)
    if (!await this.authority.approve({ hash, path, input }, signal)) throw new WasiCandidateError('execution', 'Candidate execution was not explicitly approved')
    signal.throwIfAborted()
    this.authority.audit({ hash, path, status: 'start', detail: input })
    try {
      const request: WasiWorkerRequest = {
        tree, path, input, limits: this.limits,
        ...path.endsWith('.py') ? { pythonArchive: await this.archiveBytes() } : {},
      }
      const output = await this.execute(request, signal)
      this.authority.audit({ hash, path, status: 'completed', detail: JSON.stringify(output) })
      return output
    } catch (error) {
      this.authority.audit({ hash, path, status: 'failed', detail: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  private async execute(request: WasiWorkerRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const source = import.meta.url.endsWith('.ts')
    const worker = new Worker(new URL(source ? './wasi-worker.ts' : './wasi-worker.js', import.meta.url), {
      workerData: request,
      execArgv: source ? ['--import', import.meta.resolve('tsx/esm')] : [],
      env: source ? { TSX_DISABLE_CACHE: '1', TEMP: tmpdir(), TMP: tmpdir() } : {},
      resourceLimits: { maxOldGenerationSizeMb: Math.max(64, Math.ceil(this.limits.memoryBytes / 1024 / 1024)) },
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      return await new Promise<unknown>((resolve, reject) => {
        abort = () => { reject(new WasiCandidateError('aborted', 'Candidate execution aborted', { cause: signal.reason })) }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        timer = setTimeout(() => { reject(new WasiCandidateError('timeout', 'Candidate execution exceeded its time budget')) },
          Math.min(this.limits.timeoutMs, this.limits.cpuSeconds * 1000))
        worker.once('message', (message: WasiWorkerResult) => {
          if (message.kind === 'completed') resolve(message.output)
          else reject(new WasiCandidateError('execution', message.message))
        })
        worker.once('error', (cause) => { reject(new WasiCandidateError('execution', 'Candidate interpreter failed', { cause })) })
        worker.once('exit', (code) => { reject(new WasiCandidateError('execution', `Candidate worker exited without a result (${code})`)) })
      })
    } finally {
      clearTimeout(timer)
      if (abort !== undefined) signal.removeEventListener('abort', abort)
      await worker.terminate()
    }
  }
}
