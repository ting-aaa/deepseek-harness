/** File-based Harness² editing contexts; only context/harness is writable by an editor. @module */
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateCandidateTree } from './candidate.ts'
import type { CandidateLimits, CandidateTree } from './candidate.ts'

/** Complete accepted experience exposed as a read-only library example. */
export interface EditorExperience {
  readonly task: string
  readonly candidate: CandidateTree
  readonly reflection: string
  readonly cue?: string | undefined
  readonly evidence?: string | undefined
  readonly edits?: string | undefined
}

/** Immutable input files for one propose, compose, select, or reflection child. */
export interface EditorInput {
  readonly task: string
  readonly current: CandidateTree
  readonly evidence: object
  readonly library: readonly EditorExperience[]
  readonly agent: { systemPrompt: string; tools: object[]; skills: object[]; cwd: string }
}

/** One file context, disposed only after its managed child has drained. */
export class EditorWorkspace {
  private constructor(readonly cwd: string, private readonly limits: CandidateLimits) {}

  /**
   * Materialize task, execution evidence, candidate files, and accepted examples.
   * @param parent - Private scratch parent outside the source workspace.
   * @param input - Complete stage evidence, never grading criteria or hidden references.
   * @param limits - Candidate readback limits.
   * @param maxBytes - Complete context UTF-8 byte ceiling.
   * @returns The owned context directory.
   */
  static async create(parent: string, input: EditorInput, limits: CandidateLimits, maxBytes: number): Promise<EditorWorkspace> {
    await mkdir(parent, { recursive: true })
    const cwd = await mkdtemp(join(parent, 'editor-'))
    let bytes = 0
    const put = async (path: string, content: string) => {
      const local = relative(cwd, resolve(cwd, path))
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new TypeError('Invalid Harness² context path')
      bytes += Buffer.byteLength(content)
      if (bytes > maxBytes) throw new TypeError('Harness² editor context exceeds maxScratchBytes')
      await mkdir(dirname(join(cwd, path)), { recursive: true })
      await writeFile(join(cwd, path), content, { flag: 'wx' })
    }
    try {
      await put('context/task.md', input.task)
      await put('context/evidence.json', JSON.stringify(input.evidence, null, 2))
      await put('context/agent/systemprompt.md', input.agent.systemPrompt)
      await put('context/agent/tools.json', JSON.stringify(input.agent.tools, null, 2))
      await put('context/agent/skills.json', JSON.stringify(input.agent.skills, null, 2))
      await put('context/agent/workspace.json', JSON.stringify({ cwd: input.agent.cwd }))
      for (const [path, content] of Object.entries(input.current)) await put(`context/harness/${path}`, content)
      const data = input.evidence as Record<string, unknown>
      const rollouts = ['baseline', 'history', 'finals'].flatMap((key): unknown[] => {
        const value = data[key]
        const rows: unknown[] = Array.isArray(value) ? value : []
        return rows
      })
      const written = new Set<string>()
      for (const rollout of rollouts) {
        if (rollout === null || typeof rollout !== 'object' || !('label' in rollout) || typeof rollout.label !== 'string') continue
        const label = rollout.label.replace(/[^a-z0-9_-]/gi, '_')
        if (written.has(label)) continue
        written.add(label)
        const text = 'trajectory' in rollout && typeof rollout.trajectory === 'string' ? rollout.trajectory : ''
        await put(`context/rollouts/${label}.md`, text)
        await put(`context/deliverables/${label}.md`, JSON.stringify(rollout, null, 2))
        if ('candidate' in rollout) {
          const candidate = validateCandidateTree(rollout.candidate, limits)
          for (const [path, content] of Object.entries(candidate)) await put(`context/pool/${label}/harness/${path}`, content)
        }
      }
      if ('alternatives' in data && Array.isArray(data['alternatives'])) {
        for (const [index, value] of data['alternatives'].entries()) {
          await put(`context/candidates/answer-${index + 1}.md`, JSON.stringify(value, null, 2))
        }
      }
      const index = ['# Accepted experience library']
      for (const [position, entry] of input.library.entries()) {
        const path = `context/library/task-${position + 1}`
        index.push(`- [Task ${position + 1}](task-${position + 1}/experience.md): ${JSON.stringify(entry.task)}`)
        await put(`${path}/experience.md`, JSON.stringify({ task: entry.task, cue: entry.cue, lesson: entry.reflection,
          evidence: entry.evidence, edits: entry.edits }, null, 2))
        for (const [file, content] of Object.entries(entry.candidate)) await put(`${path}/harness/${file}`, content)
      }
      await put('context/library/INDEX.md', index.join('\n'))
      return new EditorWorkspace(cwd, limits)
    } catch (error) {
      await rm(cwd, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Check a model-supplied write destination before tool execution.
   * @param args - Parsed write/edit tool arguments.
   * @returns Whether the target is strictly inside context/harness.
   */
  permitsWrite(args: unknown): boolean {
    if (args === null || typeof args !== 'object' || !('file_path' in args) || typeof args.file_path !== 'string') return false
    const path = relative(join(this.cwd, 'context', 'harness'), resolve(this.cwd, args.file_path))
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
  }

  /**
   * Read and validate the complete edited tree, rejecting links and oversized files.
   * @returns A validated immutable candidate. Empty optional files and DELETE remove components.
   */
  async candidate(): Promise<CandidateTree> {
    const directory = join(this.cwd, 'context', 'harness')
    const tree: Record<string, string> = {}
    const pending = ['']
    let files = 0
    let entries = 0
    while (pending.length) {
      const path = pending.pop() ?? ''
      for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
        entries += 1
        if (entries > this.limits.maxFiles * 8) throw new TypeError('Harness² editor candidate exceeds directory limits')
        const file = join(path, entry.name)
        const info = await lstat(join(directory, file))
        if (info.isSymbolicLink()) throw new TypeError('Harness² editor candidate cannot contain symbolic links')
        if (info.isDirectory()) { pending.push(file); continue }
        files += 1
        if (!info.isFile() || files > this.limits.maxFiles || info.size > this.limits.maxFileBytes) {
          throw new TypeError('Harness² editor candidate exceeds file limits')
        }
        const content = await readFile(join(directory, file), 'utf8')
        const normalized = file.split(sep).join('/')
        if (normalized !== 'systemprompt.md' && (!content.trim() || content.trim() === 'DELETE')) continue
        tree[normalized] = content
      }
    }
    return validateCandidateTree(tree, this.limits)
  }

  /** Remove the private context after managed child disposal. */
  async dispose(): Promise<void> { await rm(this.cwd, { recursive: true, force: true }) }
}
