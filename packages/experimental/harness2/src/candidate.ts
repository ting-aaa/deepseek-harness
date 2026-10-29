// Copyright 2026 Google LLC
// SPDX-License-Identifier: Apache-2.0
// Modified for DSH: TypeScript native surface, immutable validation and private materialization.
/** Validated, content-addressed eight-component Harness² candidate trees. @module */
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** UTF-8 files on the native Harness² editable surface. */
export type CandidateTree = Readonly<Record<string, string>>
/** Deployment-owned limits checked before materialization or model admission. */
export interface CandidateLimits {
  /** Maximum complete candidate file count. */
  maxFiles: number
  /** Maximum UTF-8 bytes in one file body. */
  maxFileBytes: number
  /** Maximum UTF-8 bytes in the complete serialized file map, including names and JSON escaping. */
  maxTotalBytes: number
  /** Maximum composed instruction characters, including component headings and separators. */
  maxAlwaysOnChars: number
}
const ALWAYS_ON = ['systemprompt.md', 'guardrails.md', 'LongTermMEMORY.md', 'tool_descriptions/tool_guidance.md'] as const
const NAME = '[a-z0-9][a-z0-9_-]*'
const SKILL = new RegExp(`^skills/(${NAME})/SKILL\\.md$`)
const SUBAGENT = new RegExp(`^sub_agents/(${NAME})/AGENT\\.md$`)
const SCRIPT = /^scripts\/[a-z0-9_]+\.py$/
const SKILL_SCRIPT = new RegExp(`^skills/${NAME}/scripts/[A-Za-z0-9_.-]+$`)
const PLUGIN = new RegExp(`^plugin/(${NAME})\\.ts$`)
function allowed(path: string): boolean {
  return !path.split('/').some(part => part === '..' || part === '.')
    && (ALWAYS_ON.some(value => value === path) || SKILL.test(path) || SUBAGENT.test(path)
      || SCRIPT.test(path) || SKILL_SCRIPT.test(path) || PLUGIN.test(path))
}
function object(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Candidate must be a file object')
  return input as Record<string, unknown>
}
/** Validate untrusted proposal files, frontmatter, triggers and complete UTF-8 budgets.
 * @param input - Complete file map; paths are canonical, not silently normalized.
 * @param limits - Positive deployment ceilings.
 * @returns An immutable sorted copy, never the caller's mutable object.
 */
export function validateCandidateTree(input: unknown, limits: CandidateLimits): CandidateTree {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Candidate limits must be positive integers')
  const entries = Object.entries(object(input)).sort(([a], [b]) => a.localeCompare(b, 'en'))
  if (entries.length > limits.maxFiles) throw new TypeError('Candidate file count exceeds limit')
  const tree: Record<string, string> = {}
  let bytes = 0
  for (const [path, value] of entries) {
    if (Buffer.byteLength(path) > 240 || !allowed(path)) throw new TypeError(`Unsupported candidate path: ${path}`)
    if (typeof value !== 'string' || value.includes('\0')) throw new TypeError(`Candidate file must be NUL-free text: ${path}`)
    const size = Buffer.byteLength(value)
    bytes += size + Buffer.byteLength(path)
    if (size > limits.maxFileBytes || bytes > limits.maxTotalBytes) throw new TypeError('Candidate UTF-8 byte limit exceeded')
    tree[path] = value
  }
  if (Buffer.byteLength(JSON.stringify(tree)) > limits.maxTotalBytes) throw new TypeError('Candidate serialized UTF-8 byte limit exceeded')
  if (tree['systemprompt.md'] === undefined) throw new TypeError('Candidate requires systemprompt.md')
  const alwaysOn = candidateInstructions(tree)
  if (alwaysOn.length > limits.maxAlwaysOnChars) throw new TypeError('Candidate always-on limit exceeded')
  for (const [path, value] of Object.entries(tree)) {
    const skill = SKILL.exec(path)
    const subagent = SUBAGENT.exec(path)
    const skillName = skill?.[1]
    if (skill || subagent) {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(value)?.[1]
      if (frontmatter === undefined || !/^description:\s*\S.*$/m.test(frontmatter)) throw new TypeError(`Missing description frontmatter: ${path}`)
      if (skillName !== undefined && (!new RegExp(`^name: ${skillName}\\s*$`, 'm').test(frontmatter) || !alwaysOn.includes(skillName))) throw new TypeError(`Skill needs matching name and always-on trigger: ${path}`)
      if (subagent && !/^mode:\s*subagent\s*$/m.test(frontmatter)) throw new TypeError(`Subagent requires mode: subagent: ${path}`)
    }
    if (SKILL_SCRIPT.test(path) && tree[`${path.split('/').slice(0, 2).join('/')}/SKILL.md`] === undefined) throw new TypeError(`Orphan skill script: ${path}`)
    if (SKILL.test(path) || ALWAYS_ON.some(item => item === path)) {
      for (const match of value.matchAll(/\bpython3?\s+((?:skills\/[\w-]+\/)?scripts\/[\w.-]+\.py)/g)) {
        if (match[1] !== undefined && tree[match[1]] === undefined) throw new TypeError(`Missing referenced script: ${match[1]}`)
      }
    }
  }
  return Object.freeze(tree)
}
/** Apply omitted-is-inherited edits; null explicitly removes a file.
 * @param base - Previous validated tree.
 * @param edits - Untrusted partial file map.
 * @param limits - Deployment limits for the complete merged result.
 * @returns Validated successor tree.
 */
export function mergeCandidateTree(base: CandidateTree, edits: unknown, limits: CandidateLimits): CandidateTree {
  const merged: Record<string, unknown> = { ...base }
  for (const [path, value] of Object.entries(object(edits))) {
    if (Buffer.byteLength(path) > 240 || !allowed(path)) throw new TypeError(`Unsupported candidate path: ${path}`)
    if (value === null) Reflect.deleteProperty(merged, path)
    else merged[path] = value
  }
  return validateCandidateTree(merged, limits)
}
/** Compute an insertion-order-independent SHA-256 over exact UTF-8 paths and contents.
 * @param tree - Validated files.
 * @returns Hexadecimal digest.
 */
export function candidateHash(tree: CandidateTree): string {
  return createHash('sha256').update(JSON.stringify(Object.keys(tree).sort().map(path => [path, tree[path]]))).digest('hex')
}
/** Compose always-on instructions; code is never represented as executable prompt text.
 * @param tree - Validated files.
 * @returns Four labeled instruction components.
 */
export function candidateInstructions(tree: CandidateTree): string {
  return ALWAYS_ON.filter(path => tree[path]).map(path => `## ${path}\n${tree[path]}`).join('\n\n')
}
/** Enumerate on-demand native resources without executing generated code.
 * @param tree - Validated files.
 * @returns Stable resource paths grouped by dispatch role.
 */
export function candidateCatalog(tree: CandidateTree): { skills: string[]; subagents: string[]; scripts: string[]; plugins: string[] } {
  const paths = Object.keys(tree).sort()
  return {
    skills: paths.filter(path => SKILL.test(path)), subagents: paths.filter(path => SUBAGENT.test(path)),
    scripts: paths.filter(path => SCRIPT.test(path) || SKILL_SCRIPT.test(path)), plugins: paths.filter(path => PLUGIN.test(path)),
  }
}
/** Materialize only in a newly created private directory; never overwrite a user's tree.
 * @param tree - Validated files.
 * @param parentDirectory - Trusted existing private scratch parent.
 * @returns Owned directory and awaited cleanup.
 */
export async function materializeCandidateTree(
  tree: CandidateTree, parentDirectory: string,
): Promise<{ directory: string; dispose(): Promise<void> }> {
  const directory = await mkdtemp(join(parentDirectory, 'harness2-'))
  try {
    await chmod(directory, 0o700)
    for (const [path, content] of Object.entries(tree)) {
      if (Buffer.byteLength(path) > 240 || !allowed(path)) throw new TypeError(`Unsupported candidate path: ${path}`)
      const parts = path.split('/')
      await mkdir(join(directory, ...parts.slice(0, -1)), { recursive: true, mode: 0o700 })
      await writeFile(join(directory, path), content, { flag: 'wx', mode: 0o600 })
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, dispose: () => rm(directory, { recursive: true, force: true }) }
}
