/** Private portable candidate worker; generated code never runs in the host realm. @module */
import { parentPort, workerData } from 'node:worker_threads'
import { WasiFileSystem } from './wasi-filesystem.ts'
import { runJavaScript } from './wasi-javascript.ts'
import { pythonAssets, runPython } from './wasi-python.ts'
import type { WasiWorkerRequest, WasiWorkerResult } from './wasi-config.ts'

async function execute(request: WasiWorkerRequest): Promise<unknown> {
  const python = request.path.endsWith('.py')
  const archive = request.pythonArchive
  if (python && archive === undefined) throw new TypeError('Python worker request has no verified interpreter archive')
  const distribution = python && archive !== undefined ? pythonAssets(archive) : undefined
  const files = new Map(distribution?.files)
  for (const [path, content] of Object.entries(request.tree)) files.set(`/candidate/${path}`, new TextEncoder().encode(content))
  const stdout: Uint8Array[] = []
  const stderr: Uint8Array[] = []
  let outputBytes = 0
  const collect = (parts: Uint8Array[]) => (bytes: Uint8Array) => {
    outputBytes += bytes.length
    if (outputBytes > request.limits.maxOutputBytes) throw new RangeError('Candidate standard streams exceed their byte ceiling')
    parts.push(bytes.slice())
  }
  const filesystem = new WasiFileSystem({ files, input: new TextEncoder().encode(request.input), limits: request.limits,
    stdout: collect(stdout), stderr: collect(stderr) })
  let value: unknown
  if (distribution !== undefined) {
    const code = await runPython(request, filesystem, distribution.wasm)
    if (code !== 0) throw new Error(`Python helper failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`)
    value = JSON.parse(Buffer.concat(stdout).toString('utf8'))
  } else value = await runJavaScript(request, filesystem, collect(stdout), collect(stderr))
  const output = { value, artifacts: filesystem.artifacts() }
  if (Buffer.byteLength(JSON.stringify(output)) + outputBytes > request.limits.maxOutputBytes) {
    throw new RangeError('Candidate complete result exceeds its byte ceiling')
  }
  return output
}

if (parentPort === null) throw new Error('Harness² WASI worker requires its owning runtime')
const port = parentPort
void execute(workerData as WasiWorkerRequest).then((output) => {
  const result: WasiWorkerResult = { kind: 'completed', output }
  port.postMessage(result)
}, (error: unknown) => {
  const result: WasiWorkerResult = { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  port.postMessage(result)
}).finally(() => { port.close() })
