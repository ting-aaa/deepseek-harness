/** Candidate file validation and private materialization behavior. */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidateCatalog, candidateHash, candidateInstructions, materializeCandidateTree, mergeCandidateTree, validateCandidateTree } from '../src/candidate.ts'
const limits = { maxFiles: 20, maxFileBytes: 4096, maxTotalBytes: 8192, maxAlwaysOnChars: 4096 }
const base = { 'systemprompt.md': 'Use careful when checking.' }
describe('candidate files', () => {
  it('validates all eight components and hashes independent of insertion order', () => {
    const tree = validateCandidateTree({ ...base, 'guardrails.md': 'Never expand authority.', 'LongTermMEMORY.md': 'Remember evidence.',
      'tool_descriptions/tool_guidance.md': 'Check outputs.', 'skills/careful/SKILL.md': '---\nname: careful\ndescription: Check facts\n---\nCheck.',
      'sub_agents/checker/AGENT.md': '---\nmode: subagent\ndescription: Check facts\n---\nReview.', 'scripts/check.py': 'print("{}")',
      'plugin/check.ts': 'export default () => ({deny: null})' }, limits)
    expect(candidateHash(tree)).toBe(candidateHash(Object.fromEntries(Object.entries(tree).reverse())))
    expect(candidateCatalog(tree)).toEqual({ skills: ['skills/careful/SKILL.md'], subagents: ['sub_agents/checker/AGENT.md'], scripts: ['scripts/check.py'], plugins: ['plugin/check.ts'] })
    expect(Object.isFrozen(tree)).toBe(true)
  })
  it.each(['../x', '/tmp/x', 'scripts/../x.py', 'skills/x/scripts/..', 'systemprompt.md\\x', '__proto__'])('rejects unsupported path %s', (path) => {
    expect(() => validateCandidateTree({ ...base, [path]: 'x' }, limits)).toThrow('Unsupported candidate path')
  })
  it('enforces emitted instructions and UTF-8 budgets', () => {
    expect(candidateInstructions(validateCandidateTree({ 'systemprompt.md': '' }, { ...limits, maxAlwaysOnChars: 1 }))).toBe('')
    expect(() => validateCandidateTree(base, { ...limits, maxAlwaysOnChars: 25 })).toThrow('always-on')
    expect(() => validateCandidateTree({ 'systemprompt.md': '你好' }, { ...limits, maxFileBytes: 5 })).toThrow('UTF-8')
    expect(() => validateCandidateTree({}, limits)).toThrow('requires systemprompt')
  })
  it('inherits omitted files and deletes only explicit null edits', () => {
    const tree = validateCandidateTree({ ...base, 'guardrails.md': 'guard' }, limits)
    expect(mergeCandidateTree(tree, { 'guardrails.md': null }, limits)).toEqual(base)
    expect(mergeCandidateTree(tree, {}, limits)).toEqual(tree)
    expect(() => mergeCandidateTree(tree, { 'systemprompt.md': null }, limits)).toThrow()
  })
  it('rejects orphan scripts, missing references and unmatched frontmatter', () => {
    expect(() => validateCandidateTree({ ...base, 'skills/x/scripts/a.py': 'pass' }, limits)).toThrow('Orphan')
    expect(() => validateCandidateTree({ 'systemprompt.md': 'python3 scripts/missing.py' }, limits)).toThrow('Missing referenced')
    expect(() => validateCandidateTree({ ...base, 'skills/x/SKILL.md': '---\nname: x\ndescription: x\n---\nx' }, limits)).toThrow('trigger')
  })
  it('materializes in a private owned directory and drains cleanup', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'candidate-test-'))
    try {
      const materialized = await materializeCandidateTree(validateCandidateTree(base, limits), parent)
      expect((await stat(materialized.directory)).mode & 0o777).toBe(0o700)
      expect(await readFile(join(materialized.directory, 'systemprompt.md'), 'utf8')).toBe(base['systemprompt.md'])
      await materialized.dispose()
      await expect(stat(materialized.directory)).rejects.toThrow()
    } finally { await rm(parent, { recursive: true, force: true }) }
  })
})
