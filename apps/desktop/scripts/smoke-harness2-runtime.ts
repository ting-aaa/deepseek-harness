/** Exercise only installed Harness² files using the prepared target's Node-compatible executable. @module */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PYTHON_WASI_ASSET as pythonAsset } from '../../../packages/subagent/harness2/src/runtime-assets.ts'
import { WASI_DEFAULTS } from '../../../packages/subagent/harness2/src/wasi-config.ts'

const PYTHON = `import json, math, sys
from pathlib import Path
request = json.load(sys.stdin)
answer = math.sqrt(request['value'])
Path('/work/python-proof.txt').write_text('python:' + str(int(answer)), encoding='utf-8')
print(json.dumps({'squareRoot': answer, 'runtime': 'python-wasi'}))
`
const TYPESCRIPT = `import {writeFile} from 'node:fs/promises';
enum Decision { Deny = 1 }
interface Input { event: string; name: string }
export default async function(input: Input) {
  await writeFile('/work/typescript-proof.txt', 'typescript:ready', 'utf8');
  const decision: Decision = Decision.Deny;
  return {deny: input.name === 'write' && decision === Decision.Deny ? 'desktop smoke denial' : null};
}
`

/**
 * Verify the first-party dependency closure, pinned CPython bytes and real built Python/TypeScript workers.
 * @param root - Installed dsh resource root, including ASAR paths after packaging.
 * @param node - Exact prepared Node or Electron executable being shipped.
 * @param environment - Private smoke environment; workers receive no ambient environment.
 * @param home - Caller-owned temporary directory for the external verification driver.
 * @returns Resolves only after both workers produce their expected JSON/artifacts and are joined.
 */
export async function smokeHarness2Runtime(root: string, node: string, environment: NodeJS.ProcessEnv, home: string): Promise<void> {
  const driver = join(home, 'harness2-runtime-smoke.mjs')
  const config = { root, asset: pythonAsset, limits: WASI_DEFAULTS, python: PYTHON, typescript: TYPESCRIPT }
  await writeFile(driver, `
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Worker} from 'node:worker_threads';
const config = ${JSON.stringify(config)};
const dshManifest = join(config.root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const requireDsh = createRequire(dshManifest);
const baseManifest = requireDsh.resolve('@deepseek-ai/dsh-base/package.json');
const requireBase = createRequire(baseManifest);
const engineManifest = realpathSync(requireBase.resolve('@deepseek-ai/dsh-harness2/package.json'));
const toolManifest = realpathSync(requireBase.resolve('@deepseek-ai/dsh-tool-harness2/package.json'));
const engine = JSON.parse(readFileSync(engineManifest, 'utf8'));
const tools = JSON.parse(readFileSync(toolManifest, 'utf8'));
const dsh = JSON.parse(readFileSync(dshManifest, 'utf8'));
assert.equal(engine.name, '@deepseek-ai/dsh-harness2');
assert.equal(tools.name, '@deepseek-ai/dsh-tool-harness2');
assert.equal(engine.version, dsh.version, 'Harness² engine belongs to another release');
assert.equal(tools.version, dsh.version, 'Harness² tools belong to another release');
assert.equal(realpathSync(createRequire(toolManifest).resolve('@deepseek-ai/dsh-harness2/package.json')), engineManifest, 'Harness² tools resolve another engine copy');
for (const manifest of [engineManifest,toolManifest]) assert.ok(statSync(join(dirname(manifest), 'lib', 'index.js')).size > 0);
const workerPath = join(dirname(engineManifest), 'lib', 'wasi-worker.js');
assert.ok(statSync(workerPath).size > 0, 'Built private WASI worker is absent');
const archive = readFileSync(join(dirname(engineManifest), 'assets', config.asset.name));
assert.equal(archive.length, config.asset.bytes, 'Packaged CPython archive size differs');
assert.equal(createHash('sha256').update(archive).digest('hex'), config.asset.sha256, 'Packaged CPython archive digest differs');
const quickjs = createRequire(engineManifest).resolve('quickjs-wasi/quickjs.wasm');
assert.ok(statSync(quickjs).size > 0, 'Packaged QuickJS WASM is absent');
async function execute(request) {
  const worker = new Worker(pathToFileURL(workerPath), {workerData:request,execArgv:[],env:{},stdout:true,stderr:true,
    resourceLimits:{maxOldGenerationSizeMb:Math.max(64,Math.ceil(request.limits.memoryBytes/1024/1024))}});
  let timer;
  let bytes = 0;
  try {
    return await new Promise((resolve,reject) => {
      const capture = chunk => {
        bytes += chunk.length;
        if (bytes > request.limits.maxOutputBytes) reject(new Error('Built Harness² worker standard streams exceeded the smoke budget'));
      };
      worker.stdout.on('data',capture);
      worker.stderr.on('data',capture);
      timer = setTimeout(() => reject(new Error('Built Harness² worker exceeded its execution deadline')), Math.min(request.limits.timeoutMs,request.limits.cpuSeconds*1000));
      worker.once('error',reject);
      worker.once('exit',code => reject(new Error('Built Harness² worker exited without a result: '+code)));
      worker.once('message',message => {
        try {
          assert.ok(Buffer.byteLength(JSON.stringify(message))+bytes <= request.limits.maxOutputBytes, 'Built Harness² worker result exceeded the smoke budget');
          assert.equal(message.kind,'completed',message.message ?? 'Built Harness² worker did not complete');
          resolve(message.output);
        } catch (error) { reject(error); }
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
const python = await execute({tree:{'systemprompt.md':'','scripts/check.py':config.python},path:'scripts/check.py',input:JSON.stringify({value:9}),limits:config.limits,pythonArchive:archive});
assert.deepEqual(python,{value:{squareRoot:3,runtime:'python-wasi'},artifacts:[{path:'python-proof.txt',base64:Buffer.from('python:3').toString('base64')}]});
const typescript = await execute({tree:{'systemprompt.md':'','plugin/check.ts':config.typescript},path:'plugin/check.ts',input:JSON.stringify({event:'before-tool',name:'write',args:{}}),limits:config.limits});
assert.deepEqual(typescript,{value:{deny:'desktop smoke denial'},artifacts:[{path:'typescript-proof.txt',base64:Buffer.from('typescript:ready').toString('base64')}]});
console.log(JSON.stringify({harness2:true,engineVersion:engine.version,pythonArchiveSha256:config.asset.sha256,builtPythonWorker:true,builtTypeScriptWorker:true,artifacts:true}));
`)
  const { stdout, stderr } = await promisify(execFile)(node, ['--expose-internals', driver], {
    cwd: home, env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 90_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  }).catch((error: unknown) => {
    if (error instanceof Error) {
      if ('stdout' in error && typeof error.stdout === 'string') process.stdout.write(error.stdout)
      if ('stderr' in error && typeof error.stderr === 'string') process.stderr.write(error.stderr)
    }
    throw error
  })
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  console.log('desktop runtime: first-party Harness² payload, Python math/artifact and TypeScript middleware/artifact passed')
}
