/** Real CPython-WASI over a private virtual filesystem. @module */
import { WASI } from '@bjorn3/browser_wasi_shim'
import { unzipSync } from 'fflate'
import { boundWasmMemory } from './wasi-memory.ts'
import type { WasiWorkerRequest } from './wasi-config.ts'
import type { WasiFileSystem } from './wasi-filesystem.ts'

/**
 * Load the pinned interpreter and read-only Python standard library from its verified archive.
 * @param archive - Distribution bytes verified by the owning runtime before worker creation.
 * @returns Interpreter bytes and immutable virtual standard-library files.
 */
export function pythonAssets(archive: Uint8Array): { wasm: Uint8Array; files: Map<string, Uint8Array> } {
  const entries = unzipSync(archive)
  const wasm = entries['python.wasm']
  if (wasm === undefined) throw new TypeError('Pinned Python distribution has no interpreter')
  const files = new Map<string, Uint8Array>()
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith('lib/python3.13/') && !name.endsWith('/')) files.set(`/usr/local/${name}`, bytes)
  }
  if (!files.has('/usr/local/lib/python3.13/encodings/__init__.py')) throw new TypeError('Pinned Python distribution has no standard library')
  return { wasm, files }
}

/**
 * Run one script with JSON stdin, a read-only candidate tree and bounded virtual output.
 * @param request - Trusted host invocation and limits.
 * @param filesystem - Worker-owned virtual files and descriptors.
 * @param wasm - Pinned interpreter bytes.
 * @returns Interpreter exit code; standard streams belong to the supplied filesystem.
 */
export async function runPython(request: WasiWorkerRequest, filesystem: WasiFileSystem, wasm: Uint8Array): Promise<number> {
  const program = `import os,runpy; os.chdir('/work'); runpy.run_path(${JSON.stringify(`/candidate/${request.path}`)},run_name='__main__')`
  const wasi = new WASI(['/python.wasm', '-I', '-B', '-c', program], ['HOME=/work', 'TMPDIR=/tmp'], filesystem.fds, { debug: false })
  const compiled = await WebAssembly.compile(boundWasmMemory(wasm, request.limits.memoryBytes))
  const instance = await WebAssembly.instantiate(compiled, { wasi_snapshot_preview1: filesystem.imports(wasi) })
  // The pinned interpreter's exported memory and _start are verified by WebAssembly instantiation.
  return wasi.start(instance as WebAssembly.Instance & { exports: { memory: WebAssembly.Memory; _start(): void } })
}
