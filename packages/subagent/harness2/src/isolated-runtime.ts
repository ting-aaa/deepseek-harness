/** Linux-only isolated JSON worker; never loads candidate code into Cordis. @module */
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { candidateCatalog, candidateHash, materializeCandidateTree } from './candidate.ts'
import type { CandidateTree } from './candidate.ts'

/** Explicit deployment configuration; unsupported platforms and namespace failures reject.
 * Adversarial code requires an externally memory-bounded container/cgroup; these limits do not bound aggregate kernel memory.
 */
export interface IsolatedRuntimeConfig {
  /** Absolute path to the trusted Linux bubblewrap executable; namespace setup failures reject. */
  bubblewrapPath: string
  /** Absolute path to trusted prlimit inside the read-only /usr mount. */
  prlimitPath: string
  /** Absolute path to trusted Python 3 inside /usr, used for scripts and the worker supervisor. */
  pythonPath: string
  /** Absolute path to trusted Node 24 or newer, mounted read-only for native TypeScript middleware. */
  nodePath: string
  /** Existing trusted private directory for fresh candidate files; each run removes its owned subdirectory after worker exit. */
  scratchDirectory: string
  /** Wall-clock milliseconds per isolated process including setup; timeout kills and drains the worker before cleanup. */
  timeoutMs: number
  /** Maximum UTF-8 bytes in the complete JSON request, checked before approval. */
  maxInputBytes: number
  /** Maximum combined stdout and stderr bytes; oversized worker output fails instead of truncating JSON. */
  maxOutputBytes: number
  /** Per-process virtual-address-space ceiling in bytes (RLIMIT_AS), not aggregate RSS; Node requires larger reservations. */
  memoryBytes: number
  /** Byte quota on each private /work and /tmp tmpfs and per-file size ceiling; these mounts are discarded after execution. */
  workspaceBytes: number
  /** Per-process CPU-time ceiling in seconds (RLIMIT_CPU); the wall-clock timeout also covers idle descendants. */
  cpuSeconds: number
  /** RLIMIT_NPROC ceiling for processes/threads charged to the worker real user ID; host user activity can consume this allowance. */
  maxProcesses: number
  /** Maximum exported regular-file count from /work; host validation also rejects duplicate and unsafe paths. */
  maxArtifactFiles: number
  /** Maximum total decoded bytes in returned artifacts; files remain logged data and are not installed into the parent workspace. */
  maxArtifactBytes: number
}
/** Approval and audit are host-owned; generated output cannot supply either. */
export interface CandidateExecutionAuthority {
  /** Human approval for this exact digest, entrypoint and input; false rejects. */
  approve(request: { hash: string; path: string; input: string }, signal: AbortSignal): Promise<boolean>
  /** Record execution before launch and its terminal result in the originating Session. */
  audit(event: { hash: string; path: string; status: 'start' | 'completed' | 'failed'; detail: string }): void
}
const PLUGIN_RUNNER = `import { readFileSync } from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
const plugin = await import('file://' + process.argv[1]);
if (typeof plugin.default !== 'function') throw new Error('Plugin must default-export a JSON handler');
const result = await plugin.default(request);
process.stdout.write(JSON.stringify(result));`

const SUPERVISOR = `import base64,json,os,stat,subprocess,sys,tempfile
max_files=int(sys.argv[1]); max_bytes=int(sys.argv[2]); max_output=int(sys.argv[3])
with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
 p=subprocess.run(sys.argv[4:],input=sys.stdin.buffer.read(),stdout=out,stderr=err)
 out.seek(0); err.seek(0)
 stdout=out.read(max_output+1); stderr=err.read(max_output+1)
 if len(stdout)+len(stderr)>max_output: raise ValueError('Candidate output budget exceeded')
sys.stderr.buffer.write(stderr)
if p.returncode: raise SystemExit(p.returncode)
value=json.loads(stdout)
artifacts=[]; total=0
for root,dirs,files in os.walk('/work',followlinks=False):
 for name in dirs:
  if os.path.islink(os.path.join(root,name)): raise ValueError('Artifact symlink directory rejected')
 for name in sorted(files):
  path=os.path.join(root,name)
  if not os.path.realpath(path).startswith('/work/'): raise ValueError('Artifact escapes workspace')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   info=os.fstat(fd)
   if not stat.S_ISREG(info.st_mode): raise ValueError('Artifact is not a regular file')
   if len(artifacts)>=max_files or info.st_size>max_bytes-total: raise ValueError('Artifact budget exceeded')
   with os.fdopen(fd,'rb',closefd=False) as f: data=f.read(max_bytes-total+1)
   total+=len(data)
   if total>max_bytes: raise ValueError('Artifact budget exceeded')
   artifacts.append({'path':os.path.relpath(path,'/work'),'base64':base64.b64encode(data).decode('ascii')})
  finally: os.close(fd)
sys.stdout.write(json.dumps({'value':value,'artifacts':artifacts}))`

/** Finite JSON-in/JSON-out execution in an empty-network, private filesystem namespace. */
export class IsolatedCandidateRuntime {
  constructor(private readonly config: IsolatedRuntimeConfig, private readonly authority: CandidateExecutionAuthority) {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError(`Invalid isolated runtime limit: ${key}`)
      if (typeof value === 'string' && !isAbsolute(value)) throw new TypeError(`Isolated runtime path must be absolute: ${key}`)
    }
  }

  /** Check real namespace creation without running candidate code; no unsafe fallback.
   * @param signal - Cancellation of the health check.
   * @returns Resolves only when the configured isolation setup executes successfully.
   */
  async preflight(signal: AbortSignal): Promise<void> {
    if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('Harness² isolation requires non-root Linux with working user/network namespaces')
    await this.process([...this.baseArgs(), '--remount-ro', '/', '/usr/bin/true'], '', signal)
  }

  /** Execute one approved script or native JSON plugin; output is data, never host authority.
   * @param tree - Validated immutable candidate.
   * @param path - Exact script or plugin file in that tree.
   * @param input - JSON request string, bounded before approval.
   * @param signal - Abort kills and drains the worker before cleanup.
   * @returns Parsed JSON output bounded in bytes including all emitted stdout/stderr.
   */
  async run(tree: CandidateTree, path: string, input: string, signal: AbortSignal): Promise<unknown> {
    const catalog = candidateCatalog(tree)
    const plugin = catalog.plugins.includes(path)
    if (!plugin && !catalog.scripts.includes(path)) throw new TypeError('Candidate entrypoint is not an executable resource')
    if (!plugin && !path.endsWith('.py')) throw new TypeError('Native script adapter supports Python only')
    if (Buffer.byteLength(input) > this.config.maxInputBytes) throw new TypeError('Candidate input exceeds byte limit')
    JSON.parse(input)
    const hash = candidateHash(tree)
    signal.throwIfAborted()
    await this.preflight(signal)
    if (!await this.authority.approve({ hash, path, input }, signal)) throw new Error('Candidate execution was not explicitly approved')
    signal.throwIfAborted()
    const materialized = await materializeCandidateTree(tree, this.config.scratchDirectory)
    try {
      this.authority.audit({ hash, path, status: 'start', detail: input })
      const args = [...this.baseArgs(), '--ro-bind', materialized.directory, '/candidate']
      if (plugin) args.push('--ro-bind', this.config.nodePath, '/runtime/node')
      args.push('--remount-ro', '/', this.config.prlimitPath, `--as=${this.config.memoryBytes}`, `--cpu=${this.config.cpuSeconds}`,
        `--nproc=${this.config.maxProcesses}`, `--fsize=${this.config.workspaceBytes}`, '--nofile=64', '--core=0', '--')
      args.push(this.config.pythonPath, '-I', '-B', '-c', SUPERVISOR, String(this.config.maxArtifactFiles), String(this.config.maxArtifactBytes), String(this.config.maxOutputBytes))
      args.push(...plugin
        ? ['/runtime/node', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', PLUGIN_RUNNER, `/candidate/${path}`]
        : [this.config.pythonPath, '-I', '-B', `/candidate/${path}`])
      const { stdout, stderr } = await this.process(args, input, signal)
      const result: unknown = JSON.parse(stdout)
      this.validateOutput(result)
      this.authority.audit({ hash, path, status: 'completed', detail: JSON.stringify({ stdout, stderr }) })
      return result
    } catch (error) {
      this.authority.audit({ hash, path, status: 'failed', detail: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      await materialized.dispose()
    }
  }

  private validateOutput(input: unknown): void {
    if (input === null || typeof input !== 'object' || Array.isArray(input) || !('value' in input)
      || !('artifacts' in input) || !Array.isArray(input.artifacts) || Object.keys(input).length !== 2
      || input.artifacts.length > this.config.maxArtifactFiles) throw new TypeError('Invalid isolated worker envelope')
    let bytes = 0
    const paths = new Set<string>()
    const artifacts: readonly unknown[] = input.artifacts
    for (const artifact of artifacts) {
      if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)
        || !('path' in artifact) || !('base64' in artifact) || typeof artifact.path !== 'string' || typeof artifact.base64 !== 'string' || Object.keys(artifact).length !== 2
        || Buffer.byteLength(artifact.path) > 240 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(artifact.path)
        || artifact.path.split('/').some((part: string) => part === '.' || part === '..') || paths.has(artifact.path)) {
        throw new TypeError('Invalid isolated artifact path or encoding')
      }
      paths.add(artifact.path)
      const content = Buffer.from(artifact.base64, 'base64')
      if (content.toString('base64') !== artifact.base64) throw new TypeError('Invalid isolated artifact base64')
      bytes += content.length
      if (bytes > this.config.maxArtifactBytes) throw new TypeError('Isolated artifact byte limit exceeded')
    }
  }

  private baseArgs(): string[] {
    return ['--unshare-all', '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
      '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
      '--proc', '/proc', '--remount-ro', '/proc', '--dev', '/dev', '--remount-ro', '/dev', '--dir', '/runtime',
      '--size', String(this.config.workspaceBytes), '--tmpfs', '/tmp',
      '--size', String(this.config.workspaceBytes), '--tmpfs', '/work', '--chdir', '/work',
      '--clearenv', '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/work', '--setenv', 'LANG', 'C.UTF-8']
  }

  private process(args: string[], input: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.bubblewrapPath, args, { env: {}, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let bytes = 0
      let failure: Error | undefined
      const stop = (error: Error) => {
        failure ??= error
        if (child.pid !== undefined) {
          try { process.kill(-child.pid, 'SIGKILL') } catch (killError) {
            if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') failure = new Error('Could not stop isolated worker', { cause: killError })
          }
        }
      }
      const abort = () => { stop(new Error('Candidate execution aborted', { cause: signal.reason })) }
      const timer = setTimeout(() => { stop(new Error('Candidate execution timed out')) }, this.config.timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > this.config.maxOutputBytes) stop(new Error('Candidate output exceeds byte limit'))
        else chunks.push(chunk)
      }
      child.stdout.on('data', collect(stdout))
      child.stderr.on('data', collect(stderr))
      child.on('error', (error) => { failure = error })
      child.stdin.on('error', (error) => { failure ??= error })
      child.once('close', (code, exitSignal) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        const output = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
        if (failure) reject(failure)
        else if (code !== 0) reject(new Error(`Isolated worker failed (${code ?? exitSignal}): ${output.stderr}`))
        else resolve(output)
      })
      child.stdin.end(input)
    })
  }
}
