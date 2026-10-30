/** Actual QuickJS WASM execution with private quota filesystems; no host files, credentials or model calls. */
import { expect, it } from 'vitest'
import { runJavaScript } from '../src/wasi-javascript.ts'
import { WasiFileSystem } from '../src/wasi-filesystem.ts'
import { WASI_DEFAULTS } from '../src/wasi-config.ts'
import type { WasiRuntimeLimits, WasiWorkerRequest } from '../src/wasi-config.ts'

function fixture(source: string, options: { input?: unknown; files?: Record<string, string>; limits?: Partial<WasiRuntimeLimits> } = {}) {
  const limits = { ...WASI_DEFAULTS, memoryBytes: 32 * 1024 * 1024, ...options.limits }
  const tree = { 'systemprompt.md': '', 'scripts/main.ts': source, ...options.files }
  const request: WasiWorkerRequest = { tree, path: 'scripts/main.ts', input: JSON.stringify(options.input ?? {}), limits }
  const stdout: Uint8Array[] = []
  const stderr: Uint8Array[] = []
  const out = (bytes: Uint8Array) => { stdout.push(bytes.slice()) }
  const err = (bytes: Uint8Array) => { stderr.push(bytes.slice()) }
  const filesystem = new WasiFileSystem({ files: new Map(Object.entries(tree).map(([path, content]) => [`/candidate/${path}`, new TextEncoder().encode(content)])),
    input: new TextEncoder().encode(request.input), limits: {
      workspaceBytes: limits.workspaceBytes, maxWorkspaceEntries: limits.maxWorkspaceEntries,
      maxArtifactFiles: limits.maxArtifactFiles, maxArtifactBytes: limits.maxArtifactBytes,
    }, stdout: out, stderr: err })
  return { filesystem, stdout, stderr, execute: () => runJavaScript(request, filesystem, out, err) }
}

it('transforms real TypeScript and awaits an asynchronous JSON handler', async () => {
  const { execute } = fixture(`
    interface Input { values: number[] }
    enum Operation { Sum = 7 }
    export default async function(input: Input) {
      await Promise.resolve();
      return { total: input.values.reduce((a, b) => a + b, 0), operation: Operation.Sum };
    }`, { input: { values: [2, 3, 5] } })
  await expect(execute()).resolves.toEqual({ total: 10, operation: 7 })
})

it('loads only declared relative candidate modules and returns deny-only middleware data', async () => {
  const { execute } = fixture(`import { allowed } from './policy.ts';
    export default async ({name}: {name: string}) => ({deny: allowed(name) ? null : 'Forbidden tool'});`, {
    input: { name: 'write' }, files: { 'scripts/policy.ts': 'export const allowed = (name: string): boolean => name === \'read\';' },
  })
  await expect(execute()).resolves.toEqual({ deny: 'Forbidden tool' })
})

it('uses virtual-only fs, fs/promises and POSIX paths for UTF-8 artifacts and bounded console output', async () => {
  const { execute, filesystem, stdout, stderr } = fixture(`
    import fs from 'node:fs';
    import {mkdir, writeFile, readFile, readdir} from 'node:fs/promises';
    import path from 'node:path';
    export default async ({value}: {value: number}) => {
      const directory = path.resolve('reports');
      await mkdir(directory, {recursive: true});
      const filename = path.join(directory, 'answer.txt');
      await writeFile(filename, '结果:' + value, 'utf8');
      console.log('done', value); console.error('note');
      return {text: await readFile(filename, 'utf8'), files: await readdir(directory), exists: fs.existsSync(filename), basename: path.basename(filename)};
    }`, { input: { value: 42 } })
  await expect(execute()).resolves.toEqual({ text: '结果:42', files: ['answer.txt'], exists: true, basename: 'answer.txt' })
  expect(filesystem.artifacts()).toEqual([{ path: 'reports/answer.txt', base64: Buffer.from('结果:42').toString('base64') }])
  expect(Buffer.concat(stdout).toString('utf8')).toBe('done 42\n')
  expect(Buffer.concat(stderr).toString('utf8')).toBe('note\n')
})

it('keeps host globals and staging callbacks unavailable even through guest Function constructors', async () => {
  const { execute } = fixture(`export default () => ({process: typeof process, require: typeof require, fetch: typeof fetch,
    staging: typeof globalThis.__harness2_virtual_host, constructor: Function('return typeof process')()});`)
  await expect(execute()).resolves.toEqual({ process: 'undefined', require: 'undefined', fetch: 'undefined', staging: 'undefined', constructor: 'undefined' })
})

it.each(['dirname()', 'basename()', 'extname()', 'relative()', 'relative(\'from\')', 'normalize()', 'isAbsolute()'])(
  'rejects missing required virtual path arguments in %s', async (call) => {
    const { execute } = fixture(`import path from 'node:path'; export default () => path.${call};`)
    await expect(execute()).rejects.toThrow('Missing virtual path argument')
  },
)

it('preserves valid empty variadic and optional virtual path arguments', async () => {
  const { execute } = fixture(`import path from 'node:path';
    export default () => ({join: path.join(), resolve: path.resolve(), basename: path.basename('/work/value.txt')});`)
  await expect(execute()).resolves.toEqual({ join: '.', resolve: '/work', basename: 'value.txt' })
})

it.each(['node:child_process', 'node:net', 'node:http', 'node:process', '../../outside.ts',
  'file:///etc/passwd', 'https://example.invalid/code.js', 'harness2:virtual-bridge'])('rejects unavailable import %s', async (specifier) => {
  const { execute } = fixture(`import value from ${JSON.stringify(specifier)}; export default () => value;`)
  await expect(execute()).rejects.toThrow(/unavailable|escapes|unsupported/u)
})

it.each([
  'import fs from \'node:fs\'; export default () => fs.readFileSync(\'/etc/passwd\', \'utf8\');',
  'import fs from \'node:fs\'; export default () => fs.writeFileSync(\'../../outside.txt\', \'bad\');',
  'import fs from \'node:fs\'; export default () => fs.writeFileSync(\'/candidate/systemprompt.md\', \'bad\');',
])('rejects host escape and read-only candidate mutations', async (source) => {
  const { execute, filesystem } = fixture(source)
  await expect(execute()).rejects.toThrow(/outside|filesystem/u)
  expect(filesystem.artifacts()).toEqual([])
  expect(new TextDecoder().decode(filesystem.read('/candidate/systemprompt.md'))).toBe('')
})

it('keeps captured serialization and UTF-8 accounting independent of guest prototype mutation', async () => {
  const { execute } = fixture(`JSON.stringify = () => '"forged"'; String.prototype.charCodeAt = () => 0;
    export default () => ({value: 'é😀'});`)
  await expect(execute()).resolves.toEqual({ value: 'é😀' })
})

it('keeps caught broker and module-loader errors free of host paths and import-meta URLs', async () => {
  const { execute } = fixture(`import {readFileSync} from 'node:fs';
    export default async () => {
      const errors = [];
      try { readFileSync('missing.txt'); } catch (error) { errors.push({message: error.message, stack: error.stack ?? ''}); }
      try { await import('node:child_process'); } catch (error) { errors.push({message: error.message, stack: error.stack ?? ''}); }
      return errors;
    };`)
  const result = await execute()
  expect(result).toMatchObject([{ message: 'Virtual filesystem operation failed (WASI errno 44)' },
    { message: 'Candidate import is unavailable: node:child_process' }])
  expect(JSON.stringify(result)).not.toMatch(/file:\/\/|[A-Z]:\\|node_modules|wasi-javascript\.ts/u)
})

it('bounds serialized UTF-8 results before copying them into the host', async () => {
  const { execute } = fixture('export default () => \'é\'.repeat(10000);', { limits: { maxOutputBytes: 128 } })
  await expect(execute()).rejects.toThrow(/byte ceiling/u)
})

it('bounds combined standard streams and does not publish an over-budget console chunk', async () => {
  const { execute, stdout, stderr } = fixture('export default () => { console.log(\'a\'.repeat(80)); console.error(\'b\'.repeat(80)); return {}; };', { limits: { maxOutputBytes: 128 } })
  await expect(execute()).rejects.toThrow(/byte ceiling|budget/u)
  expect(Buffer.concat(stdout)).toHaveLength(81)
  expect(stderr).toEqual([])
})

it('rejects an oversized virtual write before creating an artifact', async () => {
  const { execute, filesystem } = fixture('import {writeFileSync} from \'node:fs\'; export default () => {writeFileSync(\'oversized.txt\', \'012345678\'); return {};};', { limits: { workspaceBytes: 8 } })
  await expect(execute()).rejects.toThrow(/byte ceiling/u)
  expect(filesystem.artifacts()).toEqual([])
})

it('releases returned virtual-file handles between broker calls within one guest job', async () => {
  const { execute } = fixture(`import {readFileSync,writeFileSync} from 'node:fs';
    export default () => {
      writeFileSync('input.txt', 'x'.repeat(100000));
      let size = 0;
      for (let i = 0; i < 200; i++) size = readFileSync('input.txt').length;
      return {size};
    };`, { limits: { memoryBytes: 8 * 1024 * 1024 } })
  await expect(execute()).resolves.toEqual({ size: 100000 })
})

it('interrupts an infinite guest computation within its configured execution budget', async () => {
  const { execute } = fixture('export default () => { while (true) {} };', { limits: { timeoutMs: 150 } })
  await expect(execute()).rejects.toThrow(/budget|interrupt/u)
})

it('rejects a guest allocation beyond its bounded interpreter memory', async () => {
  const { execute } = fixture('export default () => new Uint8Array(64 * 1024 * 1024);', { limits: { memoryBytes: 8 * 1024 * 1024 } })
  await expect(execute()).rejects.toThrow(/memory|alloc|budget/u)
})
