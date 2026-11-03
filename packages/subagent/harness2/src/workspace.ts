/** Bounded workspace snapshots and independent rollout checkouts using the subprocess service. @module */
import { createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Deployment limits for local snapshots and private Git command output. */
export interface WorkspaceLimits {
  readonly directory: string
  readonly maxBytes: number
  readonly maxFiles: number
  readonly maxDiffBytes: number
  readonly timeoutMs: number
}

/** A task checkpoint cannot use a changed source workspace. */
export class WorkspaceFailure extends Error {
  constructor(readonly code: 'command' | 'limit' | 'path', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceFailure'
  }
}

/** Local Git commands with bounded output, cancellation, and isolated configuration. */
export class WorkspaceGit {
  constructor(private readonly subprocess: SubprocessRuntime, private readonly executable: string,
    private readonly limits: WorkspaceLimits) {}

  /**
   * Run Git without shell interpretation or ambient hooks and external diff commands.
   * @param cwd - Absolute command working directory.
   * @param args - Git arguments.
   * @param signal - Owning operation cancellation.
   * @param input - Optional UTF-8 stdin.
   * @returns Captured stdout and exit code; output loss rejects.
   */
  async run(cwd: string, args: readonly string[], signal: AbortSignal, input?: string): Promise<{ text: string; code: number | null }> {
    const control = AbortSignal.any([signal, AbortSignal.timeout(this.limits.timeoutMs)])
    const handle = this.subprocess.spawn({
      argv: [this.executable, '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', ...args], cwd,
      env: { GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
        GIT_CONFIG_GLOBAL: processNull(), GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: undefined, GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG_PARAMETERS: undefined,
        GIT_AUTHOR_NAME: 'Harness2', GIT_AUTHOR_EMAIL: 'harness2@localhost',
        GIT_COMMITTER_NAME: 'Harness2', GIT_COMMITTER_EMAIL: 'harness2@localhost' },
      stdio: { stdin: input === undefined ? 'ignore' : { data: input },
        stdout: { maxBytes: this.limits.maxDiffBytes }, stderr: { maxBytes: 8192 } },
      graceMs: 2000, signal: control,
    })
    const outcome = await handle.done
    control.throwIfAborted()
    const output = handle.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw new WorkspaceFailure('limit', 'Harness² Git output exceeded the configured bound')
    return { text: output.text, code: outcome.exitCode }
  }

  /**
   * Run a Git operation that must succeed.
   * @param cwd - Command working directory.
   * @param args - Git arguments.
   * @param signal - Operation lifetime.
   * @param input - Optional UTF-8 stdin.
   * @returns Complete stdout.
   */
  async checked(cwd: string, args: readonly string[], signal: AbortSignal, input?: string): Promise<string> {
    const result = await this.run(cwd, args, signal, input)
    if (result.code !== 0) throw new WorkspaceFailure('command', `Harness² git ${args[0]} failed (${result.code}); inspect the child evidence before retrying`)
    return result.text
  }
}

function processNull(): string { return process.platform === 'win32' ? 'NUL' : '/dev/null' }

/** One immutable source snapshot plus private per-rollout checkouts. The caller owns disposal. */
export class RolloutWorkspace {
  private constructor(readonly root: string, readonly hash: string, private readonly directory: string,
    private readonly git: WorkspaceGit, private readonly limits: WorkspaceLimits) {}

  /**
   * Snapshot tracked and nonignored working files, including dirty and untracked contents.
   * @param git - Owned command runner.
   * @param cwd - Parent workspace directory.
   * @param limits - Copy and command bounds.
   * @param signal - Run cancellation.
   * @returns A source snapshot whose files are independent of the parent workspace.
   */
  static async capture(git: WorkspaceGit, cwd: string, limits: WorkspaceLimits, signal: AbortSignal): Promise<RolloutWorkspace> {
    const located = await git.run(cwd, ['rev-parse', '--show-toplevel'], signal)
    if (located.code !== 0 && located.code !== 128) throw new WorkspaceFailure('command', 'Harness² could not locate the source workspace')
    const root = await realpath(located.code === 0 ? resolve(located.text.trim()) : resolve(cwd))
    await mkdir(limits.directory, { recursive: true })
    const scratch = relative(root, await realpath(limits.directory))
    if (scratch === '' || !scratch.startsWith(`..${sep}`) && scratch !== '..' && !isAbsolute(scratch)) {
      throw new WorkspaceFailure('path', 'Harness² scratchDirectory must be outside the source workspace')
    }
    const directory = await mkdtemp(join(limits.directory, 'run-'))
    const snapshot = join(directory, 'snapshot')
    try {
      await mkdir(snapshot)
      const files = located.code === 0
        ? (await git.checked(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean)
        : await listFiles(root, limits.maxFiles, signal)
      if (files.length > limits.maxFiles) throw new WorkspaceFailure('limit', 'Harness² workspace file count exceeds maxScratchFiles')
      let bytes = 0
      const digest = createHash('sha256')
      for (const file of [...new Set(files)].sort()) {
        signal.throwIfAborted()
        const source = resolve(root, file)
        const path = relative(root, source)
        if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) || path.split(sep).includes('.git')) {
          throw new WorkspaceFailure('path', 'Harness² snapshot contains an unsupported path')
        }
        let info
        try { info = await lstat(source) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        if (info.isDirectory()) throw new WorkspaceFailure('path', 'Harness² workspace snapshots do not support Git submodules')
        bytes += info.size
        if (bytes > limits.maxBytes) throw new WorkspaceFailure('limit', 'Harness² workspace exceeds maxScratchBytes')
        const target = join(snapshot, path)
        await mkdir(dirname(target), { recursive: true })
        digest.update(JSON.stringify([path, info.size, info.mode]))
        if (info.isSymbolicLink()) {
          const link = await readlink(source)
          digest.update(`link:${link}`)
          await symlink(link, target)
        } else if (info.isFile()) {
          await copyFile(source, target)
          digest.update(await readFile(target))
        } else {
          throw new WorkspaceFailure('path', 'Harness² workspace contains an unsupported special file')
        }
      }
      return new RolloutWorkspace(root, digest.digest('hex'), directory, git, limits)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Create an independent checkout whose Git metadata never refers to the parent repository.
   * @param signal - Run cancellation.
   * @returns The checkout directory and baseline tree used for patch collection.
   */
  async checkout(signal: AbortSignal): Promise<WorkspaceCheckout> {
    const cwd = await mkdtemp(join(this.directory, 'rollout-'))
    const gitDir = await mkdtemp(join(this.directory, 'metadata-'))
    const args = ['--git-dir', gitDir, '--work-tree', cwd]
    await cp(join(this.directory, 'snapshot'), cwd, { recursive: true, dereference: false, verbatimSymlinks: true })
    await this.git.checked(cwd, [...args, 'init', '--quiet'], signal)
    await this.git.checked(cwd, [...args, 'add', '--all', '--force', '--', '.'], signal)
    const base = (await this.git.checked(cwd, [...args, 'write-tree'], signal)).trim()
    const commit = (await this.git.checked(cwd, [...args, 'commit-tree', base], signal, 'Harness2 snapshot\n')).trim()
    await this.git.checked(cwd, [...args, 'update-ref', 'HEAD', commit], signal)
    await writeFile(join(cwd, '.git'), `gitdir: ${gitDir.replaceAll('\\', '/')}\n`)
    return { cwd, base, gitDir }
  }

  /**
   * Capture all checkout edits as a bounded Git binary patch.
   * @param checkout - Exact checkout created by this snapshot.
   * @param signal - Run cancellation.
   * @returns A patch against the original working files, including new and deleted files.
   */
  async changes(checkout: WorkspaceCheckout, signal: AbortSignal): Promise<string> {
    const args = ['--git-dir', checkout.gitDir, '--work-tree', checkout.cwd]
    const files = (await this.git.checked(checkout.cwd,
      [...args, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean)
    if (files.length > this.limits.maxFiles) throw new WorkspaceFailure('limit', 'Harness² rollout exceeds maxScratchFiles')
    let bytes = 0
    for (const file of files) {
      signal.throwIfAborted()
      const path = resolve(checkout.cwd, file)
      const local = relative(checkout.cwd, path)
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw new WorkspaceFailure('path', 'Harness² rollout contains an unsupported path')
      }
      try { bytes += (await lstat(path)).size } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (bytes > this.limits.maxBytes) throw new WorkspaceFailure('limit', 'Harness² rollout exceeds maxScratchBytes')
    }
    await this.git.checked(checkout.cwd, [...args, 'add', '--all', '--', '.'], signal)
    return this.git.checked(checkout.cwd, [...args, 'diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', checkout.base, '--'], signal)
  }

  /** Remove every snapshot and checkout after all managed children have drained. */
  async dispose(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true })
  }
}

/** A private work tree with service-owned Git metadata outside the solver's writable directory. */
export interface WorkspaceCheckout {
  readonly cwd: string
  readonly base: string
  readonly gitDir: string
}

async function listFiles(root: string, maxFiles: number, signal: AbortSignal): Promise<string[]> {
  const files: string[] = []
  const pending = ['']
  while (pending.length) {
    signal.throwIfAborted()
    const path = pending.pop() ?? ''
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const file = join(path, entry.name)
      if (entry.isDirectory()) pending.push(file)
      else files.push(file)
      if (files.length + pending.length > maxFiles) throw new WorkspaceFailure('limit', 'Harness² workspace entry count exceeds maxScratchFiles')
    }
  }
  return files
}
