/** TypeScript/JavaScript JSON handlers in private QuickJS WASM memory with virtual-only I/O. @module */
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EvalFlags, QuickJS } from 'quickjs-wasi'
import type { JSValueHandle } from 'quickjs-wasi'
import type { WasiWorkerRequest } from './wasi-config.ts'
import type { WasiFileSystem } from './wasi-filesystem.ts'
import { boundWasmMemory } from './wasi-memory.ts'

const BRIDGE = 'harness2:virtual-bridge'
const ENTRY = 'harness2:trusted-entry'
const FACADES: Readonly<Record<string, string>> = {
  fs: 'harness2:fs', 'node:fs': 'harness2:fs',
  'fs/promises': 'harness2:fs-promises', 'node:fs/promises': 'harness2:fs-promises',
  path: 'harness2:path', 'node:path': 'harness2:path',
}

/** The bridge closes over interpreter values only; staging callbacks disappear before candidate evaluation. */
const BRIDGE_SOURCE = `
const host = globalThis.__harness2_virtual_host;
delete globalThis.__harness2_virtual_host;
const parse = JSON.parse, stringify = JSON.stringify, freeze = Object.freeze;
const U8 = Uint8Array, str = String, apply = Reflect.apply;
const charCode = Function.prototype.call.bind(String.prototype.charCodeAt);
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(U8.prototype), 'byteLength').get;
const outputLimit = host.outputLimit;
const workspaceLimit = host.workspaceLimit;
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const point = charCode(text, i);
    if (point < 128) bytes++;
    else if (point < 2048) bytes += 2;
    else if (point >= 0xd800 && point <= 0xdbff && i + 1 < text.length && charCode(text, i + 1) >= 0xdc00 && charCode(text, i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function encode(text, limit) {
  const length = utf8Length(text);
  if (length > limit) throw new RangeError('Candidate virtual I/O exceeds its byte ceiling');
  const bytes = new U8(length);
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    let point = charCode(text, i);
    if (point >= 0xd800 && point <= 0xdbff && i + 1 < text.length && charCode(text, i + 1) >= 0xdc00 && charCode(text, i + 1) <= 0xdfff) point = 0x10000 + ((point - 0xd800) << 10) + charCode(text, ++i) - 0xdc00;
    else if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 128) bytes[offset++] = point;
    else if (point < 2048) { bytes[offset++] = 192 | (point >> 6); bytes[offset++] = 128 | (point & 63); }
    else if (point < 65536) { bytes[offset++] = 224 | (point >> 12); bytes[offset++] = 128 | ((point >> 6) & 63); bytes[offset++] = 128 | (point & 63); }
    else { bytes[offset++] = 240 | (point >> 18); bytes[offset++] = 128 | ((point >> 12) & 63); bytes[offset++] = 128 | ((point >> 6) & 63); bytes[offset++] = 128 | (point & 63); }
  }
  return bytes;
}
function encoding(options) {
  const value = typeof options === 'string' ? options : options?.encoding;
  if (value === undefined || value === null) return false;
  if (value !== 'utf8' && value !== 'utf-8') throw new TypeError('Virtual files support UTF-8 encoding only');
  return true;
}
function dataBytes(data) {
  if (typeof data === 'string') return encode(data, workspaceLimit);
  const length = apply(byteLength, data, []);
  if (length > workspaceLimit) throw new RangeError('Candidate virtual write exceeds its byte ceiling');
  return data;
}
const readFileSync = (path, options) => host.read(path, encoding(options));
const writeFileSync = (path, data, options) => { encoding(options); host.write(path, dataBytes(data)); };
const mkdirSync = (path, options) => host.mkdir(path, options?.recursive === true);
const readdirSync = path => parse(host.list(path));
const unlinkSync = path => host.remove(path, false, false);
const rmdirSync = path => host.remove(path, false, false);
const rmSync = (path, options) => host.remove(path, options?.recursive === true, options?.force === true);
const existsSync = path => host.exists(path);
export const promises = freeze({
  readFile: async (...args) => readFileSync(...args), writeFile: async (...args) => writeFileSync(...args),
  mkdir: async (...args) => mkdirSync(...args), readdir: async (...args) => readdirSync(...args),
  unlink: async (...args) => unlinkSync(...args), rmdir: async (...args) => rmdirSync(...args), rm: async (...args) => rmSync(...args),
});
export const fs = freeze({readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync, rmSync, existsSync, promises});
const pathCall = (name, args) => {
  for (const value of args) if (typeof value !== 'string' || value.length > 4096) throw new TypeError('Invalid virtual path argument');
  const request = stringify(args);
  if (utf8Length(request) > 32768) throw new RangeError('Virtual path arguments exceed their byte ceiling');
  return host.path(name, request);
};
const pathObject = { sep: '/', delimiter: ':',
  join: (...args) => pathCall('join', args), resolve: (...args) => pathCall('resolve', args),
  dirname: (...args) => pathCall('dirname', args), basename: (...args) => pathCall('basename', args),
  extname: (...args) => pathCall('extname', args), relative: (...args) => pathCall('relative', args),
  normalize: (...args) => pathCall('normalize', args), isAbsolute: (...args) => pathCall('isAbsolute', args),
};
pathObject.posix = pathObject;
export const path = freeze(pathObject);
const print = (channel, args) => {
  let text = '';
  for (let i = 0; i < args.length; i++) text += (i ? ' ' : '') + (typeof args[i] === 'string' ? args[i] : stringify(args[i]) ?? str(args[i]));
  text += '\\n';
  if (utf8Length(text) > host.remaining()) throw new RangeError('Candidate standard streams exceed their byte ceiling');
  channel(text);
};
globalThis.console = freeze({ log: (...args) => print(host.stdout, args), info: (...args) => print(host.stdout, args),
  debug: (...args) => print(host.stdout, args), warn: (...args) => print(host.stderr, args), error: (...args) => print(host.stderr, args) });
function bounded(value) {
  const text = stringify(value);
  if (typeof text !== 'string' || utf8Length(text) > host.remaining()) throw new RangeError('Candidate JSON result exceeds its byte ceiling');
  return text;
}
export async function execute(filename, input) {
  try {
    const module = await import(filename);
    if (typeof module.default !== 'function') throw new TypeError('Candidate must default-export a JSON handler');
    return bounded({ ok: true, value: await module.default(parse(input)) });
  } catch (error) {
    let message;
    try { message = typeof error?.message === 'string' ? error.message : str(error); }
    catch { message = 'Candidate JavaScript execution failed'; }
    if (utf8Length(message) > outputLimit / 2) message = 'Candidate JavaScript error exceeds its byte ceiling';
    return bounded({ ok: false, message });
  }
}
`

const FS_SOURCE = `import {fs} from '${BRIDGE}'; export default fs;
export const {readFileSync,writeFileSync,mkdirSync,readdirSync,unlinkSync,rmdirSync,rmSync,existsSync,promises}=fs;`
const PROMISES_SOURCE = `import {promises} from '${BRIDGE}'; export default promises;
export const {readFile,writeFile,mkdir,readdir,unlink,rmdir,rm}=promises;`
const PATH_SOURCE = `import {path} from '${BRIDGE}'; export default path;
export const {join,resolve,dirname,basename,extname,relative,normalize,isAbsolute,sep,delimiter,posix}=path;`

/** QuickJS copies host Error stacks into guest errors unless the host removes them first. */
function guestError(error: unknown): Error {
  const sanitized = new Error(error instanceof Error ? error.message : 'Candidate virtual operation failed')
  delete sanitized.stack
  return sanitized
}

/**
 * Execute one JSON handler without exposing Node, process globals, host descriptors or network APIs.
 * @param request - Immutable candidate, exact entrypoint/input, and deployment limits.
 * @param filesystem - Owned virtual filesystem with allocation-time quotas.
 * @param stdout - Host-owned byte-bounded standard output sink.
 * @param stderr - Host-owned byte-bounded standard error sink.
 * @returns The guest-serialized and byte-checked JSON value; artifacts remain in the virtual filesystem.
 */
export async function runJavaScript(
  request: WasiWorkerRequest, filesystem: WasiFileSystem,
  stdout: (bytes: Uint8Array) => void, stderr: (bytes: Uint8Array) => void,
): Promise<unknown> {
  const { limits } = request
  const deadline = Date.now() + Math.min(limits.timeoutMs, limits.cpuSeconds * 1000)
  let streamBytes = 0
  const emit = (sink: (bytes: Uint8Array) => void, bytes: Uint8Array) => {
    if (bytes.byteLength > limits.maxOutputBytes - streamBytes) throw new RangeError('Candidate standard streams exceed their byte ceiling')
    streamBytes += bytes.byteLength
    sink(bytes)
  }
  const sources = new Map([[BRIDGE, BRIDGE_SOURCE], ['harness2:fs', FS_SOURCE], ['harness2:fs-promises', PROMISES_SOURCE], ['harness2:path', PATH_SOURCE]])
  const normalize = (base: string, specifier: string): string => {
    try {
      if (specifier === BRIDGE && (base === ENTRY || sources.has(base) && base !== BRIDGE)) return BRIDGE
      const facade = FACADES[specifier]
      if (Object.hasOwn(FACADES, specifier) && facade !== undefined) return facade
      if (specifier.includes('\\') || (!specifier.startsWith('./') && !specifier.startsWith('../')
      && !((base === BRIDGE || base === ENTRY) && specifier.startsWith('/candidate/')))) {
        throw new TypeError(`Candidate import is unavailable: ${specifier}`)
      }
      const path = posix.resolve(posix.dirname(base), specifier)
      if (!path.startsWith('/candidate/') || !Object.hasOwn(request.tree, path.slice('/candidate/'.length)) || !/\.[cm]?js$|\.ts$/u.test(path)) {
        throw new TypeError('Candidate import escapes its declared source tree or has an unsupported extension')
      }
      return path
    } catch (error) { throw guestError(error) }
  }
  const wasm = await readFile(fileURLToPath(import.meta.resolve('quickjs-wasi/quickjs.wasm')))
  using vm = await QuickJS.create({
    wasm: boundWasmMemory(wasm, limits.memoryBytes), memoryLimit: limits.memoryBytes,
    interruptHandler: () => Date.now() >= deadline,
    moduleLoader: { normalize, load: (name) => {
      try {
        const builtin = sources.get(name)
        if (builtin !== undefined) return builtin
        const source = request.tree[name.slice('/candidate/'.length)]
        if (!name.startsWith('/candidate/') || source === undefined) throw new TypeError('Undeclared candidate module')
        return name.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: name }) : source
      } catch (error) { throw guestError(error) }
    } },
    wasi: memory => ({ fd_write: (fd: number, pointer: number, count: number, written: number): number => {
      if (fd !== 1 && fd !== 2) return 8
      const bytes = new Uint8Array(memory.buffer)
      const view = new DataView(memory.buffer)
      if (!Number.isSafeInteger(count) || count < 0 || pointer < 0 || count > Math.floor((bytes.length - pointer) / 8)
        || written < 0 || written > bytes.length - 4) return 21
      let total = 0
      for (let index = 0; index < count; index++) {
        const start = view.getUint32(pointer + index * 8, true)
        const length = view.getUint32(pointer + index * 8 + 4, true)
        if (start > bytes.length || length > bytes.length - start) return 21
        emit(fd === 1 ? stdout : stderr, bytes.subarray(start, start + length))
        total += length
      }
      view.setUint32(written, total, true)
      return 0
    } }),
  })
  const string = (handle: JSValueHandle | undefined, maximum = 4096): string => {
    if (!handle?.isString || handle.length > maximum) throw new TypeError('Invalid virtual filesystem argument')
    return handle.toString()
  }
  const path = (handle: JSValueHandle | undefined) => {
    const value = string(handle)
    if (value.includes('\\') || value.includes('\0')) throw new TypeError('Virtual paths must be NUL-free POSIX paths')
    const absolute = posix.resolve('/work', value)
    if (!['/candidate', '/work', '/tmp'].some(root => absolute === root || absolute.startsWith(`${root}/`))) throw new TypeError('Virtual path is outside candidate and private workspace roots')
    return absolute
  }
  using actualByteLength = vm.evalCode(`(() => {
    const apply = Reflect.apply;
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
    return value => apply(getter, value, []);
  })()`)
  const remove = (target: string, recursive: boolean, force: boolean): void => {
    try {
      if (recursive) {
        let names: string[] | undefined
        try { names = filesystem.list(target) } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'errno' in error && error.errno === 54)) throw error
        }
        for (const name of names ?? []) remove(posix.join(target, name), true, false)
      }
      filesystem.remove(target)
    } catch (error) {
      if (!force || !(typeof error === 'object' && error !== null && 'errno' in error && error.errno === 44)) throw error
    }
  }
  const host = vm.newObject()
  let callbackResult: JSValueHandle | undefined
  try {
    const functions: Record<string, (...args: JSValueHandle[]) => JSValueHandle> = {
      read: (target?: JSValueHandle, utf8?: JSValueHandle) => {
        const bytes = filesystem.read(path(target))
        return utf8?.toBoolean() ? vm.newString(new TextDecoder().decode(bytes)) : vm.newUint8Array(bytes)
      },
      write: (target?: JSValueHandle, data?: JSValueHandle) => {
        if (data === undefined || data.isProxy || data.className !== 'Uint8Array') throw new TypeError('Virtual writes require Uint8Array data')
        using size = vm.callFunction(actualByteLength, vm.undefined, data)
        if (size.toNumber() > limits.workspaceBytes) throw new RangeError('Candidate virtual write exceeds its byte ceiling')
        filesystem.write(path(target), data.toUint8Array())
        return vm.undefined
      },
      mkdir: (target?: JSValueHandle, recursive?: JSValueHandle) => {
        const absolute = path(target)
        if (!recursive?.toBoolean()) filesystem.mkdir(absolute)
        else {
          let current = ''
          for (const component of absolute.slice(1).split('/')) {
            current += `/${component}`
            if (current === '/work' || current === '/tmp') continue
            try { filesystem.mkdir(current) } catch (error) {
              if (!(typeof error === 'object' && error !== null && 'errno' in error && error.errno === 20)) throw error
            }
          }
        }
        return vm.undefined
      },
      list: (target?: JSValueHandle) => vm.newString(JSON.stringify(filesystem.list(path(target)))),
      remove: (target?: JSValueHandle, recursive?: JSValueHandle, force?: JSValueHandle) => {
        remove(path(target), recursive?.toBoolean() ?? false, force?.toBoolean() ?? false)
        return vm.undefined
      },
      exists: (target?: JSValueHandle) => {
        const absolute = path(target)
        try { filesystem.read(absolute); return vm.true } catch (error) {
          if (!(typeof error === 'object' && error !== null && 'errno' in error && error.errno === 31)) return vm.false
        }
        filesystem.list(absolute)
        return vm.true
      },
      path: (operation?: JSValueHandle, argumentsJson?: JSValueHandle) => {
        const args: unknown = JSON.parse(string(argumentsJson, 32768))
        if (!Array.isArray(args) || args.length > 128) throw new TypeError('Invalid virtual path arguments')
        const values: unknown[] = args
        if (!values.every((part): part is string => typeof part === 'string' && part.length <= 4096)) {
          throw new TypeError('Invalid virtual path arguments')
        }
        const required = (index: number): string => {
          const value = values[index]
          if (value === undefined) throw new TypeError('Missing virtual path argument')
          return value
        }
        let value: string | boolean
        switch (string(operation)) {
          case 'join': value = posix.join(...values); break
          case 'resolve': value = posix.resolve('/work', ...values); break
          case 'dirname': value = posix.dirname(required(0)); break
          case 'basename': value = posix.basename(required(0), values[1]); break
          case 'extname': value = posix.extname(required(0)); break
          case 'relative': value = posix.relative(required(0), required(1)); break
          case 'normalize': value = posix.normalize(required(0)); break
          case 'isAbsolute': value = posix.isAbsolute(required(0)); break
          default: throw new TypeError('Unavailable virtual path operation')
        }
        return typeof value === 'string' ? vm.newString(value) : value ? vm.true : vm.false
      },
      stdout: (text?: JSValueHandle) => {
        emit(stdout, new TextEncoder().encode(string(text, limits.maxOutputBytes)))
        return vm.undefined
      },
      stderr: (text?: JSValueHandle) => {
        emit(stderr, new TextEncoder().encode(string(text, limits.maxOutputBytes)))
        return vm.undefined
      },
      remaining: () => vm.newNumber(limits.maxOutputBytes - streamBytes),
    }
    for (const [name, callback] of Object.entries(functions)) {
      using handle = vm.newFunction(name, (...args) => {
        // The trampoline already duplicated the prior return before another non-reentrant broker call.
        callbackResult?.dispose()
        callbackResult = undefined
        let result: JSValueHandle
        try { result = callback(...args) } catch (error) { throw guestError(error) }
        if (result !== vm.undefined && result !== vm.true && result !== vm.false) callbackResult = result
        return result
      })
      host.setProp(name, handle)
    }
    using outputLimit = vm.newNumber(limits.maxOutputBytes)
    using workspaceLimit = vm.newNumber(limits.workspaceBytes)
    host.setProp('outputLimit', outputLimit)
    host.setProp('workspaceLimit', workspaceLimit)
    vm.global.setProp('__harness2_virtual_host', host)
  } finally { host.dispose() }
  const evaluate = async (source: string, name: string): Promise<JSValueHandle> => {
    using evaluation = vm.evalCode(source, name, EvalFlags.TYPE_MODULE)
    const settlement = vm.resolvePromise(evaluation)
    vm.executePendingJobs()
    const result = await settlement
    if ('error' in result) { result.error.dispose(); throw new Error('Candidate JavaScript module failed or exceeded its execution budget') }
    return result.value
  }
  const initialized = await evaluate(BRIDGE_SOURCE, BRIDGE)
  initialized.dispose()
  const filename = `/candidate/${request.path}`
  using result = await evaluate(`import {execute} from '${BRIDGE}'; export default await execute(${JSON.stringify(filename)},${JSON.stringify(request.input)});`, ENTRY)
  using encoded = result.getProp('default')
  if (!encoded.isString || encoded.length > limits.maxOutputBytes) throw new RangeError('Candidate JSON result exceeds its byte ceiling')
  const text = encoded.toString()
  if (Buffer.byteLength(text) > limits.maxOutputBytes - streamBytes) throw new RangeError('Candidate JSON result exceeds its byte ceiling')
  const envelope: unknown = JSON.parse(text)
  if (envelope === null || typeof envelope !== 'object' || !('ok' in envelope)) throw new TypeError('Invalid private JavaScript result')
  if (envelope.ok === false) throw new Error('message' in envelope && typeof envelope.message === 'string' ? envelope.message : 'Candidate JavaScript execution failed')
  if (!('value' in envelope)) throw new TypeError('Candidate must return a JSON value')
  return envelope.value
}
