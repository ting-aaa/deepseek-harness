/** Worker protocol tests mock only OS spawning, not candidate validation or authority. */
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IsolatedCandidateRuntime } from '../src/isolated-runtime.ts'
import type { CandidateExecutionAuthority, IsolatedRuntimeConfig } from '../src/isolated-runtime.ts'
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
function processResult(code: number, stdout = '', stderr = '') {
  spawn.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
    child.stdin.on('finish', () => { child.stdout.write(stdout); child.stderr.write(stderr); child.emit('close', code, null) })
    return child
  })
}
const config: IsolatedRuntimeConfig = { bubblewrapPath: '/usr/bin/bwrap', prlimitPath: '/usr/bin/prlimit', pythonPath: '/usr/bin/python3', nodePath: process.execPath,
  scratchDirectory: '/tmp', timeoutMs: 1000, maxInputBytes: 1024, maxOutputBytes: 4096, memoryBytes: 536870912, workspaceBytes: 1048576,
  cpuSeconds: 1, maxProcesses: 64, maxArtifactFiles: 2, maxArtifactBytes: 1024 }
afterEach(() => { vi.resetAllMocks() })
describe.runIf(process.platform === 'linux' && process.getuid?.() !== 0)('isolated protocol authority', () => {
  it('fails closed before approval and materialization when namespaces fail', async () => {
    processResult(1, '', 'Operation not permitted')
    const approve = vi.fn(async () => true)
    const runtime = new IsolatedCandidateRuntime(config, { approve, audit: vi.fn() })
    await expect(runtime.run({ 'systemprompt.md': '', 'scripts/a.py': 'print("{}")' }, 'scripts/a.py', '{}', new AbortController().signal)).rejects.toThrow('Operation not permitted')
    expect(approve).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('requires explicit approval even after successful health check', async () => {
    processResult(0)
    const runtime = new IsolatedCandidateRuntime(config, { approve: async () => false, audit: vi.fn() })
    await expect(runtime.run({ 'systemprompt.md': '', 'scripts/a.py': 'pass' }, 'scripts/a.py', '{}', new AbortController().signal)).rejects.toThrow('not explicitly approved')
    expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('keeps diagnostics separate and launches with empty environment and read-only root', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'protocol-test-'))
    try {
      processResult(0)
      processResult(0, '{"value":42,"artifacts":[]}', 'diagnostic')
      const audit = vi.fn<CandidateExecutionAuthority['audit']>()
      const runtime = new IsolatedCandidateRuntime({ ...config, scratchDirectory: scratch }, { approve: async () => true, audit })
      await expect(runtime.run({ 'systemprompt.md': '', 'scripts/a.py': 'print(42)' }, 'scripts/a.py', '{}', new AbortController().signal)).resolves.toEqual({ value: 42, artifacts: [] })
      expect(spawn.mock.calls[1]![2]).toMatchObject({ env: {} })
      expect(spawn.mock.calls[1]![1]).toContain('--unshare-all')
      expect(spawn.mock.calls[1]![1]).toContain('--remount-ro')
      expect(audit.mock.calls.map(call => call[0].status)).toEqual(['start', 'completed'])
    } finally { await rm(scratch, { recursive: true, force: true }) }
  })
  it.each([
    { path: '../escape', base64: '' },
    { path: 'bad', base64: '@@' },
    { path: '/absolute', base64: '' },
    { path: 'large', base64: Buffer.alloc(1025).toString('base64') },
  ])('rejects forged artifact metadata from worker output', async (artifact) => {
    processResult(0)
    processResult(0, JSON.stringify({ value: null, artifacts: [artifact] }))
    const runtime = new IsolatedCandidateRuntime(config, { approve: async () => true, audit: vi.fn() })
    await expect(runtime.run({ 'systemprompt.md': '', 'scripts/a.py': 'pass' }, 'scripts/a.py', '{}', new AbortController().signal)).rejects.toThrow(/artifact/i)
  })
  it('never spawns a worker for already cancelled work', async () => {
    const runtime = new IsolatedCandidateRuntime(config, { approve: async () => true, audit: vi.fn() })
    await expect(runtime.preflight(AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })
  it('rejects oversized combined stderr and stdout', async () => {
    processResult(0)
    processResult(0, '{}', 'x'.repeat(4096))
    const runtime = new IsolatedCandidateRuntime(config, { approve: async () => true, audit: vi.fn() })
    await expect(runtime.run({ 'systemprompt.md': '', 'scripts/a.py': 'pass' }, 'scripts/a.py', '{}', new AbortController().signal)).rejects.toThrow('output exceeds byte limit')
  })
})
