/** Real namespace fixture: opt in only on a non-root Linux executor with bubblewrap. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { IsolatedCandidateRuntime } from '../src/isolated-runtime.ts'
import { validateCandidateTree } from '../src/candidate.ts'

it.runIf(process.env['DSH_TEST_HARNESS2_ISOLATION'] === '1')('executes actual isolated Python, exports artifacts, denies host/network access and keeps stderr separate', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'isolated-candidate-test-'))
  try {
    const runtime = new IsolatedCandidateRuntime({
      bubblewrapPath: '/usr/bin/bwrap', prlimitPath: '/usr/bin/prlimit', pythonPath: '/usr/bin/python3', nodePath: process.execPath,
      scratchDirectory: scratch, timeoutMs: 5000, maxInputBytes: 4096, maxOutputBytes: 16384,
      memoryBytes: 536870912, workspaceBytes: 1048576,
      cpuSeconds: 3, maxProcesses: 64, maxArtifactFiles: 5, maxArtifactBytes: 4096 }, { approve: async () => true, audit: () => {} })
    await runtime.preflight(AbortSignal.timeout(5000))
    const tree = validateCandidateTree({ 'systemprompt.md': '', 'scripts/check.py': `import json,os,socket,sys,subprocess
assert not os.path.exists('/home/agent')
assert 'DEEPSEEK_API_KEY' not in os.environ
assert subprocess.run(['/usr/bin/unshare','--user','--map-root-user','true'],capture_output=True).returncode != 0
s=socket.socket();s.settimeout(.1)
try: s.connect(('1.1.1.1',443)); raise AssertionError('network reachable')
except OSError: pass
open('/work/result.txt','w').write('artifact bytes')
print('diagnostic',file=sys.stderr)
print(json.dumps({'ok':True}))` }, { maxFiles: 5, maxFileBytes: 4096, maxTotalBytes: 8192, maxAlwaysOnChars: 4096 })
    await expect(runtime.run(tree, 'scripts/check.py', '{}', AbortSignal.timeout(5000))).resolves.toEqual({ value: { ok: true }, artifacts: [{ path: 'result.txt', base64: Buffer.from('artifact bytes').toString('base64') }] })
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

it.runIf(process.env['DSH_TEST_HARNESS2_ISOLATION'] === '1')('executes actual TypeScript middleware through the finite JSON adapter', async () => {
  const memoryBytes = Number(process.env['DSH_TEST_HARNESS2_NODE_MEMORY_BYTES'])
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 1) {
    throw new Error('Set DSH_TEST_HARNESS2_NODE_MEMORY_BYTES to a deployment-validated Node virtual-memory limit inside a memory-bounded container')
  }
  const scratch = await mkdtemp(join(tmpdir(), 'isolated-plugin-test-'))
  try {
    const runtime = new IsolatedCandidateRuntime({
      bubblewrapPath: '/usr/bin/bwrap', prlimitPath: '/usr/bin/prlimit', pythonPath: '/usr/bin/python3', nodePath: process.execPath,
      scratchDirectory: scratch, timeoutMs: 5000, maxInputBytes: 4096, maxOutputBytes: 16384,
      memoryBytes, workspaceBytes: 1048576, cpuSeconds: 3, maxProcesses: 64, maxArtifactFiles: 5, maxArtifactBytes: 4096,
    }, { approve: async () => true, audit: () => {} })
    const tree = validateCandidateTree({
      'systemprompt.md': '',
      'plugin/check.ts': `import { writeFileSync } from 'node:fs';
type Request = { event: string; name: string };
export default (request: Request) => {
  writeFileSync('/work/plugin.txt', request.event);
  return { deny: request.name === 'blocked' ? 'Policy denied' : null };
};`,
    }, { maxFiles: 5, maxFileBytes: 4096, maxTotalBytes: 8192, maxAlwaysOnChars: 4096 })
    await expect(runtime.run(tree, 'plugin/check.ts', '{"event":"before-tool","name":"blocked"}', AbortSignal.timeout(5000)))
      .resolves.toEqual({ value: { deny: 'Policy denied' }, artifacts: [{ path: 'plugin.txt', base64: Buffer.from('before-tool').toString('base64') }] })
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
