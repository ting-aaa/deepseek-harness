import { describe, expect, it } from 'vitest'
import { WasiCandidateRuntime } from '../src/wasi-runtime.ts'
import type { CandidateExecutionAuthority } from '../src/isolated-runtime.ts'
import type { WasiRuntimeConfig } from '../src/wasi-config.ts'

function harness(config: Partial<WasiRuntimeConfig> = {}, approved = true, onAudit?: CandidateExecutionAuthority['audit']) {
  const events: Parameters<CandidateExecutionAuthority['audit']>[0][] = []
  const approvals: Parameters<CandidateExecutionAuthority['approve']>[0][] = []
  const runtime = new WasiCandidateRuntime({ backend: 'wasi', ...config }, {
    approve: async (request) => { approvals.push(request); return approved },
    audit: (event) => { events.push(event); onAudit?.(event) },
  })
  return { runtime, events, approvals }
}

const signal = () => new AbortController().signal
const python = (source: string) => ({ 'systemprompt.md': '', 'scripts/main.py': source })

describe('portable generated Python execution', () => {
  it('runs approved TypeScript middleware through the same owned-worker API', async () => {
    const { runtime, events } = harness()
    const tree = { 'systemprompt.md': '', 'plugin/guard.ts': [
      'import {writeFile} from "node:fs/promises";',
      'interface Input { name: string }',
      'enum Action { Deny = 1 }',
      'export default async function(input: Input) {',
      ' await writeFile("/work/result.txt", "ready", "utf8");',
      ' return {deny: input.name === "write" && Action.Deny === 1 ? "review first" : null};',
      '}',
    ].join('\n') }
    await expect(runtime.run(tree, 'plugin/guard.ts', '{"name":"write"}', signal())).resolves.toEqual({
      value: { deny: 'review first' }, artifacts: [{ path: 'result.txt', base64: Buffer.from('ready').toString('base64') }],
    })
    expect(events.map(event => event.status)).toEqual(['start', 'completed'])
  })

  it('executes real Python JSON, standard library computation and nested artifacts', async () => {
    const { runtime, events, approvals } = harness()
    const output = await runtime.run(python([
      'import json,sys,math,os',
      'request=json.load(sys.stdin)',
      'os.mkdir("out")',
      'answer=math.isqrt(request["value"])',
      'open("out/answer.txt","w",encoding="utf-8").write(str(answer))',
      'print(json.dumps({"answer":answer,"cwd":os.getcwd(),"python":list(sys.version_info[:2])}))',
    ].join('\n')), 'scripts/main.py', '{"value":144}', signal())
    expect(output).toEqual({ value: { answer: 12, cwd: '/work', python: [3, 13] },
      artifacts: [{ path: 'out/answer.txt', base64: Buffer.from('12').toString('base64') }] })
    expect(approvals).toMatchObject([{ path: 'scripts/main.py', input: '{"value":144}' }])
    expect(events.map(event => event.status)).toEqual(['start', 'completed'])
  })

  it('has no host filesystem, network, subprocess or inherited credential access', async () => {
    const { runtime } = harness()
    const output = await runtime.run(python([
      'import json,os,subprocess',
      'result={}',
      'for name,operation in [("host",lambda:open("/etc/passwd").read()),("process",lambda:subprocess.run(["cmd.exe","/c","echo escaped"]))]:',
      ' try: operation(); result[name]=False',
      ' except (OSError,NotImplementedError): result[name]=True',
      'try:',
      ' import socket',
      ' socket.socket().connect(("127.0.0.1",1))',
      ' result["network"]=False',
      'except (ImportError,OSError,NotImplementedError): result["network"]=True',
      'result["environment"]=dict(os.environ)',
      'print(json.dumps(result))',
    ].join('\n')), 'scripts/main.py', '{}', signal())
    expect(output).toMatchObject({ value: { host: true, process: true, network: true,
      environment: { HOME: '/work', TMPDIR: '/tmp' } }, artifacts: [] })
    const environment = (output as { value: { environment: object } }).value.environment
    expect(Object.keys(environment).some(name => /KEY|TOKEN|SECRET|PASSWORD|USERPROFILE|PATH/iu.test(name))).toBe(false)
  })

  it('denies workspace growth before allocating outside the private byte budget', async () => {
    const { runtime, events } = harness({ workspaceBytes: 64 })
    await expect(runtime.run(python('import json,errno\ntry:\n open("too-large","wb",buffering=0).write(b"x"*65)\nexcept OSError as error:\n print(json.dumps({"bounded":error.errno==errno.ENOSPC}))'), 'scripts/main.py', '{}', signal()))
      .resolves.toEqual({ value: { bounded: true }, artifacts: [{ path: 'too-large', base64: '' }] })
    expect(events.map(event => event.status)).toEqual(['start', 'completed'])
  })

  it('rejects sparse file growth without allocating the requested host memory', async () => {
    const { runtime } = harness({ workspaceBytes: 1024 })
    await expect(runtime.run(python('import json,errno\ntry:\n open("sparse","wb").truncate(2**48)\nexcept OSError as error:\n print(json.dumps({"bounded":error.errno in (errno.ENOSPC,errno.EFBIG,errno.EOVERFLOW)}))'), 'scripts/main.py', '{}', signal()))
      .resolves.toEqual({ value: { bounded: true }, artifacts: [{ path: 'sparse', base64: '' }] })
  })

  it('enforces the WebAssembly memory ceiling inside real CPython', async () => {
    const { runtime } = harness({ memoryBytes: 32 * 1024 * 1024 })
    const output = await runtime.run(python('import json\ntry:\n x=bytearray(128*1024*1024)\nexcept MemoryError:\n print(json.dumps({"bounded":True}))'),
      'scripts/main.py', '{}', signal())
    expect(output).toEqual({ value: { bounded: true }, artifacts: [] })
  })

  it('terminates and joins a nonterminating worker at its deadline', async () => {
    const { runtime, events } = harness({ timeoutMs: 3000 })
    await expect(runtime.run(python('while True: pass'), 'scripts/main.py', '{}', signal()))
      .rejects.toMatchObject({ code: 'timeout' })
    expect(events.map(event => event.status)).toEqual(['start', 'failed'])
  })

  it('joins an aborted worker and can execute a later request', async () => {
    const started = Promise.withResolvers<undefined>()
    const { runtime, events } = harness({}, true, (event) => { if (event.status === 'start') started.resolve(undefined) })
    const controller = new AbortController()
    const running = runtime.run(python('while True: pass'), 'scripts/main.py', '{}', controller.signal)
    const rejected = expect(running).rejects.toMatchObject({ code: 'aborted' })
    await started.promise
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    controller.abort(new Error('test cancellation'))
    await rejected
    expect(events.map(event => event.status)).toEqual(['start', 'failed'])
    await expect(runtime.run(python('print("null")'), 'scripts/main.py', '{}', signal()))
      .resolves.toEqual({ value: null, artifacts: [] })
  })

  it('bounds complete output and requires exact approval before worker execution', async () => {
    const denied = harness({}, false)
    await expect(denied.runtime.run(python('print("null")'), 'scripts/main.py', '{}', signal()))
      .rejects.toMatchObject({ code: 'execution' })
    expect(denied.events).toEqual([])
    const { runtime } = harness({ maxOutputBytes: 128 })
    await expect(runtime.run(python('import json; print(json.dumps("x"*1000))'), 'scripts/main.py', '{}', signal()))
      .rejects.toMatchObject({ code: 'execution' })
  })
})
