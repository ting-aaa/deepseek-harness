/** Pure virtual WASI files with independent, allocation-time /work and /tmp quotas. @module */
import { Buffer } from 'node:buffer'
import { ConsoleStdout, Directory, File, OpenDirectory, OpenFile, PreopenDirectory, wasi } from '@bjorn3/browser_wasi_shim'
import type { Fd, Inode, WASI } from '@bjorn3/browser_wasi_shim'

interface Limits {
  workspaceBytes: number
  maxWorkspaceEntries: number
  maxArtifactFiles: number
  maxArtifactBytes: number
}
interface Options {
  files: ReadonlyMap<string, Uint8Array>
  input: Uint8Array
  limits: Limits
  stdout: (bytes: Uint8Array) => void
  stderr: (bytes: Uint8Array) => void
}
interface Quota { bytes: number; entries: number }
interface Entry { quota: Quota; linked: boolean; opens: number; counted: boolean }
interface Location { parent: Directory; name: string; node: Inode | undefined }

class FsError extends Error {
  constructor(readonly errno: number) { super(`Virtual filesystem operation failed (WASI errno ${errno})`) }
}

/** In-memory guest files only; no operation resolves a host path or creates a host descriptor. */
export class WasiFileSystem {
  /** stdin, stdout, stderr and one virtual-root preopen, ready for the maintained WASI shim. */
  readonly fds: Fd[]
  private readonly root = new Directory(new Map())
  private readonly entries = new Map<Inode, Entry>()
  private readonly limits: Limits

  /** Construct a fresh guest tree. Supplied files must be canonical absolute paths below the two read-only roots.
   * @param options - Immutable candidate/runtime files, finite input, allocation limits and bounded output sinks.
   */
  constructor(options: Options) {
    const { workspaceBytes, maxWorkspaceEntries, maxArtifactFiles, maxArtifactBytes } = options.limits
    this.limits = { workspaceBytes, maxWorkspaceEntries, maxArtifactFiles, maxArtifactBytes }
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid WASI filesystem limit: ${name}`)
    }
    for (const path of ['/candidate', '/usr/local/lib/python3.13', '/work', '/tmp']) this.seedDirectory(path)
    for (const [path, bytes] of options.files) {
      if ((!path.startsWith('/candidate/') && !path.startsWith('/usr/local/lib/python3.13/')) || this.canonical(path) !== path) {
        throw new TypeError('Invalid read-only WASI file path')
      }
      const separator = path.lastIndexOf('/')
      const name = path.slice(separator + 1)
      const directory = this.seedDirectory(path.slice(0, separator))
      if (directory.contents.has(name)) throw new TypeError('Duplicate WASI file path')
      directory.contents.set(name, new File(bytes, { readonly: true }))
    }
    for (const name of ['work', 'tmp']) {
      const directory = this.lookup(this.root, name)
      this.entries.set(directory, { quota: { bytes: 0, entries: 0 }, linked: true, opens: 0, counted: false })
    }
    const preopen = new PreopenDirectory('/', this.root.contents)
    this.fds = [this.fileDescriptor(new OpenFile(new File(options.input, { readonly: true }))),
      new ConsoleStdout(options.stdout), new ConsoleStdout(options.stderr), this.directoryDescriptor(preopen)]
  }

  /** Wrap mutation imports before the shim copies guest buffers or performs an unsafe rename.
   * @param runtime - The WASI instance constructed with this filesystem's descriptors.
   * @returns Imports for wasi_snapshot_preview1, including guarded scatter/gather writes.
   */
  imports(runtime: WASI): WASI['wasiImport'] {
    return { ...runtime.wasiImport,
      fd_write: (fd: number, pointer: number, count: number, result: number) => this.writeVectors(runtime, fd, pointer, count, result),
      fd_pwrite: (fd: number, pointer: number, count: number, offset: bigint, result: number) =>
        this.writeVectors(runtime, fd, pointer, count, result, offset),
      fd_renumber: (fd: number, target: number) => fd === target ? (runtime.fds[fd] ? wasi.ERRNO_SUCCESS : wasi.ERRNO_BADF)
        : this.invoke(runtime, 'fd_renumber', [fd, target]),
      path_open: (fd: number, flags: number, pointer: number, length: number, oflags: number,
        rights: bigint, inheriting: bigint, fdflags: number, result: number) => {
        const memory = runtime.inst.exports.memory.buffer
        if (!this.span(memory, pointer, length) || !this.span(memory, result, 4)) return wasi.ERRNO_FAULT
        const reusable = runtime.fds.findIndex((descriptor: Fd | undefined) => descriptor === undefined)
        if (reusable < 0 && runtime.fds.length >= Math.max(64, this.limits.maxWorkspaceEntries + 4)) return wasi.ERRNO_MFILE
        const ret = this.invoke(runtime, 'path_open', [fd, flags, pointer, length, oflags, rights, inheriting, fdflags, result])
        if (ret === wasi.ERRNO_SUCCESS && reusable >= 0) {
          const descriptor = runtime.fds.pop()
          if (!descriptor) throw new TypeError('Missing opened WASI descriptor')
          runtime.fds[reusable] = descriptor
          new DataView(memory).setUint32(result, reusable, true)
        }
        return ret
      },
      path_link: () => wasi.ERRNO_NOTSUP,
      path_symlink: () => wasi.ERRNO_NOTSUP,
      path_rename: (fd: number, oldPointer: number, oldLength: number, target: number, newPointer: number, newLength: number) =>
        this.attempt(() => {
          const source = runtime.fds[fd]
          const destination = runtime.fds[target]
          if (!(source instanceof OpenDirectory) || !(destination instanceof OpenDirectory)) throw new FsError(wasi.ERRNO_BADF)
          const oldPath = this.guestPath(runtime, oldPointer, oldLength)
          const newPath = this.guestPath(runtime, newPointer, newLength)
          this.rename(source.dir, oldPath, destination.dir, newPath)
        }),
      sock_accept: () => wasi.ERRNO_NOTSUP,
      sock_recv: () => wasi.ERRNO_NOTSUP,
      sock_send: () => wasi.ERRNO_NOTSUP,
      sock_shutdown: () => wasi.ERRNO_NOTSUP,
    }
  }

  /** Read a guest regular file without exposing its mutable backing buffer.
   * @param path - Absolute POSIX guest path.
   * @returns A copy of the file's bytes.
   */
  read(path: string): Uint8Array {
    const node = this.lookup(this.root, this.absolute(path))
    if (!(node instanceof File)) throw new FsError(wasi.ERRNO_ISDIR)
    return node.data.slice()
  }

  /** Replace or create a writable guest regular file, checking quota before copying bytes.
   * @param path - Absolute path below /work or /tmp with an existing parent directory.
   * @param bytes - Complete replacement contents.
   */
  write(path: string, bytes: Uint8Array): void {
    const location = this.location(this.root, this.absolute(path))
    const quota = this.writable(location.parent).quota
    if (location.node && !(location.node instanceof File)) throw new FsError(wasi.ERRNO_ISDIR)
    const previous = location.node instanceof File ? location.node.data.byteLength : 0
    if (bytes.byteLength > this.limits.workspaceBytes - quota.bytes + previous) throw new FsError(wasi.ERRNO_NOSPC)
    if (!location.node && quota.entries >= this.limits.maxWorkspaceEntries) throw new FsError(wasi.ERRNO_NOSPC)
    const data = bytes.slice()
    if (location.node instanceof File) location.node.data = data
    else this.insert(location, new File(data), quota)
    quota.bytes += data.byteLength - previous
  }

  /** Create one writable guest directory.
   * @param path - Absolute guest path with an existing parent directory.
   */
  mkdir(path: string): void { this.create(this.root, this.absolute(path), true) }

  /** List direct child names in deterministic order.
   * @param path - Absolute POSIX guest directory.
   * @returns Child names, excluding dot entries.
   */
  list(path: string): string[] {
    const directory = this.lookup(this.root, this.absolute(path))
    if (!(directory instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
    return [...directory.contents.keys()].sort()
  }

  /** Unlink a regular file or empty directory, retaining quota while a guest descriptor still holds it.
   * @param path - Absolute path below a writable root.
   */
  remove(path: string): void { this.unlink(this.root, this.absolute(path)) }

  /** Collect regular files below /work after enforcing safe names and complete decoded-byte/file limits.
   * @returns Relative paths and canonical base64 contents; /tmp and read-only files are excluded.
   */
  artifacts(): { path: string; base64: string }[] {
    const files: { path: string; file: File }[] = []
    let total = 0
    const walk = (directory: Directory, prefix: string) => {
      for (const [name, node] of [...directory.contents].sort(([a], [b]) => a.localeCompare(b))) {
        const path = prefix + name
        if (node instanceof Directory) walk(node, `${path}/`)
        else if (node instanceof File) {
          if (Buffer.byteLength(path) > 240 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
            || path.split('/').some(part => part === '.' || part === '..')) throw new TypeError('Invalid isolated artifact path or encoding')
          if (files.length >= this.limits.maxArtifactFiles || node.data.byteLength > this.limits.maxArtifactBytes - total) throw new TypeError('Isolated artifact budget exceeded')
          total += node.data.byteLength
          files.push({ path, file: node })
        } else throw new TypeError('Artifact is not a regular file')
      }
    }
    const work = this.lookup(this.root, 'work')
    if (!(work instanceof Directory)) throw new TypeError('Missing WASI workspace')
    walk(work, '')
    return files.map(({ path, file }) => ({ path, base64: Buffer.from(file.data).toString('base64') }))
  }

  private directoryDescriptor<T extends OpenDirectory>(descriptor: T): T {
    const directory = descriptor.dir
    this.open(directory, descriptor)
    descriptor.path_open = (_flags, path, oflags, rights, _inheriting, fdflags) => {
      try {
        let node: Inode
        let created = false
        try { node = this.lookup(directory, path) } catch (error) {
          if (!(error instanceof FsError) || error.errno !== wasi.ERRNO_NOENT || !(oflags & wasi.OFLAGS_CREAT)) throw error
          node = this.create(directory, path, !!(oflags & wasi.OFLAGS_DIRECTORY))
          created = true
        }
        if ((oflags & wasi.OFLAGS_CREAT) && (oflags & wasi.OFLAGS_EXCL) && !created) throw new FsError(wasi.ERRNO_EXIST)
        if ((oflags & wasi.OFLAGS_DIRECTORY) && !(node instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
        if ((oflags & (wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC)) || (rights & BigInt(wasi.RIGHTS_FD_WRITE))) this.writable(node)
        const previous = node instanceof File ? node.data.byteLength : 0
        const result = node.path_open(oflags, rights, fdflags)
        if (result.ret !== wasi.ERRNO_SUCCESS || !result.fd_obj) return result
        if (node instanceof File) {
          const entry = this.entries.get(node)
          if (entry) entry.quota.bytes += node.data.byteLength - previous
        }
        return { ret: wasi.ERRNO_SUCCESS, fd_obj: result.fd_obj instanceof OpenFile ? this.fileDescriptor(result.fd_obj)
          : result.fd_obj instanceof OpenDirectory ? this.directoryDescriptor(result.fd_obj) : result.fd_obj }
      } catch (error) { return { ret: this.errno(error), fd_obj: null } }
    }
    descriptor.path_create_directory = path => this.attempt(() => { this.create(directory, path, true) })
    descriptor.path_unlink_file = path => this.attempt(() => {
      const node = this.lookup(directory, path)
      if (node instanceof Directory) throw new FsError(wasi.ERRNO_ISDIR)
      this.unlink(directory, path)
    })
    descriptor.path_remove_directory = path => this.attempt(() => {
      if (!(this.lookup(directory, path) instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
      this.unlink(directory, path)
    })
    descriptor.path_link = () => wasi.ERRNO_NOTSUP
    descriptor.path_unlink = () => ({ ret: wasi.ERRNO_NOTSUP, inode_obj: null })
    descriptor.path_filestat_set_times = (_flags, path) => this.attempt(() => {
      this.writable(this.lookup(directory, path))
      throw new FsError(wasi.ERRNO_NOTSUP)
    })
    return descriptor
  }

  private fileDescriptor(descriptor: OpenFile): OpenFile {
    const file = descriptor.file
    this.open(file, descriptor)
    const resize = (size: bigint, operation: () => number) => this.attempt(() => {
      this.capacity(file, size)
      const previous = file.data.byteLength
      const result = operation()
      if (result !== wasi.ERRNO_SUCCESS) throw new FsError(result)
      this.writable(file).quota.bytes += file.data.byteLength - previous
    })
    const allocate = descriptor.fd_allocate.bind(descriptor)
    descriptor.fd_allocate = (offset, length) => offset < 0n || length < 0n ? wasi.ERRNO_INVAL
      : resize(file.size > offset + length ? file.size : offset + length, () => allocate(offset, length))
    const truncate = descriptor.fd_filestat_set_size.bind(descriptor)
    descriptor.fd_filestat_set_size = size => resize(size, () => truncate(size))
    const write = descriptor.fd_write.bind(descriptor)
    descriptor.fd_write = (data) => {
      const ret = resize(descriptor.file_pos + BigInt(data.byteLength), () => write(data).ret)
      return { ret, nwritten: ret === wasi.ERRNO_SUCCESS ? data.byteLength : 0 }
    }
    const pwrite = descriptor.fd_pwrite.bind(descriptor)
    descriptor.fd_pwrite = (data, offset) => {
      const ret = resize(offset + BigInt(data.byteLength), () => offset < 0n ? wasi.ERRNO_INVAL : pwrite(data, offset).ret)
      return { ret, nwritten: ret === wasi.ERRNO_SUCCESS ? data.byteLength : 0 }
    }
    descriptor.fd_filestat_set_times = () => file.readonly ? wasi.ERRNO_ROFS : wasi.ERRNO_NOTSUP
    return descriptor
  }

  private writeVectors(runtime: WASI, fd: number, pointer: number, count: number, result: number, offset?: bigint): unknown {
    const descriptor = runtime.fds[fd]
    if (!descriptor) return wasi.ERRNO_BADF
    const memory = runtime.inst.exports.memory.buffer
    if (!this.span(memory, pointer, count * 8) || !this.span(memory, result, 4)) return wasi.ERRNO_FAULT
    const view = new DataView(memory)
    let total = 0n
    for (let i = 0; i < count; i++) {
      const start = view.getUint32(pointer + i * 8, true)
      const length = view.getUint32(pointer + i * 8 + 4, true)
      if (!this.span(memory, start, length)) return wasi.ERRNO_FAULT
      total += BigInt(length)
    }
    if (descriptor instanceof OpenFile) {
      const ret = this.attempt(() => {
        if (offset !== undefined && offset < 0n) throw new FsError(wasi.ERRNO_INVAL)
        this.capacity(descriptor.file, (offset ?? descriptor.file_pos) + total)
      })
      if (ret !== wasi.ERRNO_SUCCESS) { view.setUint32(result, 0, true); return ret }
    }
    return offset === undefined ? this.invoke(runtime, 'fd_write', [fd, pointer, count, result])
      : this.invoke(runtime, 'fd_pwrite', [fd, pointer, count, offset, result])
  }

  private capacity(file: File, size: bigint): void {
    if (size < 0n) throw new FsError(wasi.ERRNO_INVAL)
    const entry = this.writable(file)
    const growth = size > file.size ? size - file.size : 0n
    if (growth > BigInt(this.limits.workspaceBytes - entry.quota.bytes)) throw new FsError(wasi.ERRNO_NOSPC)
  }

  private open(node: Inode, descriptor: Fd): void {
    const entry = this.entries.get(node)
    if (!entry) return
    entry.opens++
    let closed = false
    descriptor.fd_close = () => {
      if (closed) return wasi.ERRNO_BADF
      closed = true
      entry.opens--
      this.release(node, entry)
      return wasi.ERRNO_SUCCESS
    }
  }

  private writable(node: Inode): Entry {
    const entry = this.entries.get(node)
    if (!entry) throw new FsError(wasi.ERRNO_ROFS)
    if (!entry.linked && node instanceof Directory) throw new FsError(wasi.ERRNO_NOENT)
    return entry
  }

  private create(directory: Directory, path: string, isDirectory: boolean): Inode {
    const location = this.location(directory, path)
    const quota = this.writable(location.parent).quota
    if (location.node) throw new FsError(wasi.ERRNO_EXIST)
    if (quota.entries >= this.limits.maxWorkspaceEntries) throw new FsError(wasi.ERRNO_NOSPC)
    const node = isDirectory ? new Directory(new Map()) : new File(new Uint8Array())
    this.insert(location, node, quota)
    return node
  }

  private insert(location: Location, node: Inode, quota: Quota): void {
    location.parent.contents.set(location.name, node)
    this.entries.set(node, { quota, linked: true, opens: 0, counted: true })
    quota.entries++
  }

  private unlink(directory: Directory, path: string): void {
    const location = this.location(directory, path)
    this.writable(location.parent)
    if (!location.node) throw new FsError(wasi.ERRNO_NOENT)
    const entry = this.writable(location.node)
    if (!entry.counted) throw new FsError(wasi.ERRNO_BUSY)
    if (location.node instanceof Directory && location.node.contents.size) throw new FsError(wasi.ERRNO_NOTEMPTY)
    location.parent.contents.delete(location.name)
    entry.linked = false
    this.release(location.node, entry)
  }

  private release(node: Inode, entry: Entry): void {
    if (entry.linked || entry.opens) return
    if (node instanceof File) entry.quota.bytes -= node.data.byteLength
    if (entry.counted) entry.quota.entries--
    this.entries.delete(node)
  }

  private rename(from: Directory, oldPath: string, to: Directory, newPath: string): void {
    const source = this.location(from, oldPath)
    const target = this.location(to, newPath)
    const sourceRoot = this.writable(source.parent)
    const targetRoot = this.writable(target.parent)
    if (sourceRoot.quota !== targetRoot.quota) throw new FsError(wasi.ERRNO_XDEV)
    if (!source.node) throw new FsError(wasi.ERRNO_NOENT)
    if (source.parent === target.parent && source.name === target.name) return
    if (target.node) {
      if (source.node instanceof Directory && !(target.node instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
      if (!(source.node instanceof Directory) && target.node instanceof Directory) throw new FsError(wasi.ERRNO_ISDIR)
    }
    if (source.node instanceof Directory && this.contains(source.node, target.parent)) throw new FsError(wasi.ERRNO_INVAL)
    if (target.node) this.unlink(to, newPath)
    source.parent.contents.delete(source.name)
    target.parent.contents.set(target.name, source.node)
  }

  private contains(directory: Directory, target: Directory): boolean {
    if (directory === target) return true
    for (const node of directory.contents.values()) if (node instanceof Directory && this.contains(node, target)) return true
    return false
  }

  private parts(path: string): string[] {
    if (path.startsWith('/') || /[\u0000\\:]/.test(path)) throw new FsError(wasi.ERRNO_NOTCAPABLE)
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') { if (!parts.length) throw new FsError(wasi.ERRNO_NOTCAPABLE); parts.pop() }
      else parts.push(part)
    }
    return parts
  }

  private lookup(directory: Directory, path: string): Inode {
    let node: Inode = directory
    for (const name of this.parts(path)) {
      if (!(node instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
      const child = node.contents.get(name)
      if (!child) throw new FsError(wasi.ERRNO_NOENT)
      node = child
    }
    if (path.endsWith('/') && !(node instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
    return node
  }

  private location(directory: Directory, path: string): Location {
    const parts = this.parts(path)
    const name = parts.pop()
    if (!name) throw new FsError(wasi.ERRNO_INVAL)
    const parent = this.lookup(directory, parts.join('/'))
    if (!(parent instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
    const node = parent.contents.get(name)
    if (path.endsWith('/') && node && !(node instanceof Directory)) throw new FsError(wasi.ERRNO_NOTDIR)
    return { parent, name, node }
  }

  private absolute(path: string): string {
    if (!path.startsWith('/')) throw new FsError(wasi.ERRNO_NOTCAPABLE)
    return path.slice(1)
  }

  private canonical(path: string): string { return `/${this.parts(this.absolute(path)).join('/')}` }

  private seedDirectory(path: string): Directory {
    let current = this.root
    for (const name of this.parts(this.absolute(path))) {
      let child = current.contents.get(name)
      if (!child) { child = new Directory(new Map()); current.contents.set(name, child) }
      if (!(child instanceof Directory)) throw new TypeError('WASI file shadows a directory')
      current = child
    }
    return current
  }

  private guestPath(runtime: WASI, pointer: number, length: number): string {
    const memory = runtime.inst.exports.memory.buffer
    if (!this.span(memory, pointer, length)) throw new FsError(wasi.ERRNO_FAULT)
    return new TextDecoder().decode(new Uint8Array(memory, pointer, length))
  }

  private span(memory: ArrayBufferLike, pointer: number, length: number): boolean {
    return Number.isSafeInteger(pointer) && Number.isSafeInteger(length) && pointer >= 0 && length >= 0
      && pointer <= memory.byteLength - length
  }

  private invoke(runtime: WASI, name: string, args: (number | bigint)[]): unknown {
    const operation = runtime.wasiImport[name]
    if (!operation) throw new TypeError(`Missing WASI import: ${name}`)
    return operation(...args)
  }

  private errno(error: unknown): number { if (error instanceof FsError) return error.errno; throw error }
  private attempt(operation: () => void): number {
    try { operation(); return wasi.ERRNO_SUCCESS } catch (error) { return this.errno(error) }
  }
}
