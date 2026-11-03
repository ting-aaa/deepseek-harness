/** Exercise the actual shim import entry points with guest linear memory and no host mounts. */
import { File, OpenFile, WASI, wasi } from '@bjorn3/browser_wasi_shim'
import { describe, expect, it } from 'vitest'
import { WasiFileSystem } from '../src/wasi-filesystem.ts'

const bytes = (value: string) => new TextEncoder().encode(value)
const text = (value: Uint8Array) => new TextDecoder().decode(value)
const limits = { workspaceBytes: 32, maxWorkspaceEntries: 8, maxArtifactFiles: 4, maxArtifactBytes: 32 }

function fixture(overrides: Partial<typeof limits> = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const fs = new WasiFileSystem({ files: new Map([['/candidate/main.py', bytes('candidate')],
    ['/usr/local/lib/python3.13/json/__init__.py', bytes('stdlib')]]), input: bytes('input'),
  limits: { ...limits, ...overrides }, stdout: data => stdout.push(text(data)), stderr: data => stderr.push(text(data)) })
  const runtime = new WASI([], [], fs.fds)
  const memory = new WebAssembly.Memory({ initial: 1 })
  runtime.initialize({ exports: { memory } })
  const imports = fs.imports(runtime)
  const view = new DataView(memory.buffer)
  const buffer = new Uint8Array(memory.buffer)
  function path(value: string, pointer = 128) {
    const data = bytes(value); buffer.set(data, pointer); return { pointer, length: data.length }
  }
  function open(value: string, flags = wasi.OFLAGS_CREAT, rights = BigInt(wasi.RIGHTS_FD_WRITE), parent = 3) {
    const { pointer, length } = path(value)
    const ret = imports.path_open!(parent, 0, pointer, length, flags, rights, 0n, 0, 16)
    return { ret, fd: view.getUint32(16, true) }
  }
  function vectors(values: string[]) {
    let pointer = 4096
    values.forEach((value, index) => {
      const data = bytes(value)
      buffer.set(data, pointer)
      view.setUint32(512 + index * 8, pointer, true)
      view.setUint32(516 + index * 8, data.length, true)
      pointer += data.length
    })
    return values.length
  }
  function write(fd: number, values: string[], offset?: bigint) {
    const count = vectors(values)
    return offset === undefined ? imports.fd_write!(fd, 512, count, 24) : imports.fd_pwrite!(fd, 512, count, offset, 24)
  }
  function operation(name: string, value: string, parent = 3) {
    const { pointer, length } = path(value)
    return imports[name]!(parent, pointer, length)
  }
  function rename(from: string, to: string) {
    const source = path(from)
    const target = path(to, 1024)
    return imports.path_rename!(3, source.pointer, source.length, 3, target.pointer, target.length)
  }
  return { fs, runtime, imports, memory, buffer, view, open, write, operation, rename, vectors, stdout, stderr }
}

describe('bounded virtual WASI files', () => {
  it('mounts candidate and Python files read-only and starts both writable roots empty', () => {
    const { fs } = fixture()
    expect(fs.list('/')).toEqual(['candidate', 'tmp', 'usr', 'work'])
    expect(fs.list('/work')).toEqual([])
    expect(fs.list('/tmp')).toEqual([])
    expect(text(fs.read('/usr/local/lib/python3.13/json/__init__.py'))).toBe('stdlib')
    const copied = fs.read('/candidate/main.py')
    copied.fill(0)
    expect(text(fs.read('/candidate/main.py'))).toBe('candidate')
    expect(() => fs.read('/etc/passwd')).toThrow()
    expect(() => fs.read('C:\\Windows\\win.ini')).toThrow()
    expect(() => fs.read('/work/../../etc/passwd')).toThrow()
    expect(() => { fs.write('/candidate/main.py', bytes('changed')) }).toThrow()
    expect(() => { fs.mkdir('/usr/local/lib/python3.13/new') }).toThrow()
    expect(() => { fs.remove('/candidate/main.py') }).toThrow()
  })

  it.each(['/candidate/../escape', '/candidate//duplicate', '/candidate/file/', '/candidate/C:\\file', '/etc/passwd', 'candidate/file'])('rejects unsafe supplied paths: %s', (path) => {
    expect(() => new WasiFileSystem({ files: new Map([[path, bytes('x')]]), input: bytes(''), limits, stdout: () => {}, stderr: () => {} })).toThrow()
  })

  it('rejects supplied file/directory collisions and invalid numeric limits', () => {
    expect(() => new WasiFileSystem({ files: new Map([['/candidate/a', bytes('x')], ['/candidate/a/b', bytes('y')]]),
      input: bytes(''), limits, stdout: () => {}, stderr: () => {} })).toThrow('shadows a directory')
    expect(() => fixture({ workspaceBytes: 0 })).toThrow('Invalid WASI filesystem limit')
    expect(() => fixture({ maxWorkspaceEntries: 1.5 })).toThrow('Invalid WASI filesystem limit')
  })

  it('accepts the filesystem fields of the shared runtime limits object', () => {
    const runtimeLimits = { ...limits, backend: 'wasi', timeoutMs: 1000 }
    const fs = new WasiFileSystem({ files: new Map(), input: bytes(''), limits: runtimeLimits, stdout: () => {}, stderr: () => {} })
    fs.write('/work/file', bytes('data'))
    expect(text(fs.read('/work/file'))).toBe('data')
  })

  it('provides finite stdin and separate stdout/stderr through actual imports', () => {
    const { imports, view, buffer, write, stdout, stderr } = fixture()
    view.setUint32(512, 4096, true)
    view.setUint32(516, 100, true)
    expect(imports.fd_read!(0, 512, 1, 24)).toBe(0)
    expect(view.getUint32(24, true)).toBe(5)
    expect(text(buffer.subarray(4096, 4101))).toBe('input')
    expect(imports.fd_read!(0, 512, 1, 24)).toBe(0)
    expect(view.getUint32(24, true)).toBe(0)
    expect(write(1, ['hello', '世界'])).toBe(0)
    expect(write(2, ['warning'])).toBe(0)
    expect(stdout).toEqual(['hello', '世界'])
    expect(stderr).toEqual(['warning'])
    expect(write(0, ['overwrite'])).toBe(wasi.ERRNO_ROFS)
  })

  it('supports nested regular artifact files, seek, pwrite, readdir and copied broker writes', () => {
    const { fs, open, operation, write, imports, view } = fixture()
    expect(operation('path_create_directory', 'work/nested')).toBe(0)
    const file = open('work/nested/output.txt')
    expect(file.ret).toBe(0)
    expect(write(file.fd, ['abc'])).toBe(0)
    expect(write(file.fd, ['Z'], 1n)).toBe(0)
    expect(imports.fd_seek!(file.fd, 3n, wasi.WHENCE_SET, 32)).toBe(0)
    expect(write(file.fd, ['!'])).toBe(0)
    const directory = open('work/nested', wasi.OFLAGS_DIRECTORY, 0n)
    expect(directory.ret).toBe(0)
    expect(imports.fd_readdir!(directory.fd, 8192, 512, 0n, 24)).toBe(0)
    expect(view.getUint32(24, true)).toBeGreaterThan(0)
    const content = bytes('temporary')
    fs.write('/tmp/file', content)
    content.fill(0)
    expect(text(fs.read('/tmp/file'))).toBe('temporary')
    expect(fs.artifacts()).toEqual([{ path: 'nested/output.txt', base64: Buffer.from('aZc!').toString('base64') }])
    expect(fs.list('/work/nested')).toEqual(['output.txt'])
  })

  it('rejects read-only writes, truncate, allocate and directory mutations through imports', () => {
    const { fs, open, operation, imports, write } = fixture()
    const file = open('candidate/main.py', 0, BigInt(wasi.RIGHTS_FD_READ))
    expect(file.ret).toBe(0)
    expect(write(file.fd, ['bad'])).toBe(wasi.ERRNO_ROFS)
    expect(write(file.fd, ['bad'], 0n)).toBe(wasi.ERRNO_ROFS)
    expect(imports.fd_allocate!(file.fd, 0n, 1n)).toBe(wasi.ERRNO_ROFS)
    expect(imports.fd_filestat_set_size!(file.fd, 0n)).toBe(wasi.ERRNO_ROFS)
    expect(imports.fd_filestat_set_size!(file.fd, 1n << 63n)).toBe(wasi.ERRNO_ROFS)
    expect(imports.fd_filestat_set_times!(file.fd, 0n, 0n, 0)).toBe(wasi.ERRNO_ROFS)
    expect(open('candidate/main.py', wasi.OFLAGS_TRUNC, 0n).ret).toBe(wasi.ERRNO_ROFS)
    expect(open('candidate/new.py').ret).toBe(wasi.ERRNO_ROFS)
    expect(operation('path_create_directory', 'candidate/new')).toBe(wasi.ERRNO_ROFS)
    expect(operation('path_unlink_file', 'candidate/main.py')).toBe(wasi.ERRNO_ROFS)
    expect(operation('path_remove_directory', 'usr/local/lib/python3.13/json')).toBe(wasi.ERRNO_ROFS)
    expect(text(fs.read('/candidate/main.py'))).toBe('candidate')
    expect(imports.path_link!(3, 0, 0, 0, 3, 0, 0)).toBe(wasi.ERRNO_NOTSUP)
    expect(imports.path_symlink!(0, 0, 3, 0, 0)).toBe(wasi.ERRNO_NOTSUP)
    for (const name of ['sock_accept', 'sock_recv', 'sock_send', 'sock_shutdown']) expect(imports[name]!(0, 0, 0)).toBe(wasi.ERRNO_NOTSUP)
  })

  it('checks combined iovec growth before copying or partially writing a file', () => {
    const { fs, open, write, imports, runtime } = fixture({ workspaceBytes: 8 })
    const file = open('work/file')
    expect(write(file.fd, ['12345', '6789'])).toBe(wasi.ERRNO_NOSPC)
    expect(fs.read('/work/file')).toHaveLength(0)
    expect(write(file.fd, ['1234', '5678'])).toBe(0)
    const descriptor = runtime.fds[file.fd]
    expect(descriptor).toBeInstanceOf(OpenFile)
    if (!(descriptor instanceof OpenFile)) throw new Error('Missing file descriptor')
    const data = descriptor.file.data
    expect(imports.fd_allocate!(file.fd, 1n << 63n, 1n)).toBe(wasi.ERRNO_NOSPC)
    expect(imports.fd_filestat_set_size!(file.fd, 9n)).toBe(wasi.ERRNO_NOSPC)
    expect(write(file.fd, ['x'], 1n << 63n)).toBe(wasi.ERRNO_NOSPC)
    expect(imports.fd_seek!(file.fd, 1n << 62n, wasi.WHENCE_SET, 32)).toBe(0)
    expect(write(file.fd, ['x'])).toBe(wasi.ERRNO_NOSPC)
    expect(descriptor.file.data).toBe(data)
    expect(text(data)).toBe('12345678')
    expect(imports.fd_filestat_set_size!(file.fd, 3n)).toBe(0)
    expect(imports.fd_allocate!(file.fd, 0n, 8n)).toBe(0)
    expect(fs.read('/work/file')).toEqual(new Uint8Array([49, 50, 51, 0, 0, 0, 0, 0]))
    expect(imports.fd_allocate!(file.fd, -1n, 2n)).toBe(wasi.ERRNO_INVAL)
    expect(imports.fd_filestat_set_size!(file.fd, -1n)).toBe(wasi.ERRNO_INVAL)
    expect(write(file.fd, ['x'], -1n)).toBe(wasi.ERRNO_INVAL)
  })

  it('keeps /work and /tmp byte and directory-entry budgets independent', () => {
    const { fs, operation, open } = fixture({ workspaceBytes: 4, maxWorkspaceEntries: 2 })
    fs.mkdir('/work/directory')
    fs.write('/work/directory/file', bytes('1234'))
    fs.mkdir('/tmp/directory')
    fs.write('/tmp/directory/file', bytes('1234'))
    expect(() => { fs.write('/work/extra', bytes('')) }).toThrow()
    expect(open('work/extra').ret).toBe(wasi.ERRNO_NOSPC)
    expect(operation('path_create_directory', 'tmp/extra')).toBe(wasi.ERRNO_NOSPC)
    expect(operation('path_remove_directory', 'work/directory')).toBe(wasi.ERRNO_NOTEMPTY)
    fs.remove('/work/directory/file')
    fs.write('/work/new', bytes('1234'))
    expect(() => { fs.write('/work/new', bytes('12345')) }).toThrow()
    expect(text(fs.read('/work/new'))).toBe('1234')
    expect(text(fs.read('/tmp/directory/file'))).toBe('1234')
  })

  it('accounts aggregate file sizes and releases truncated or closed replacement bytes', () => {
    const { fs, open, imports, write } = fixture({ workspaceBytes: 4 })
    fs.write('/work/one', bytes('abc'))
    const first = open('work/one', 0, 0n)
    const second = open('work/two')
    expect(write(second.fd, ['xy'])).toBe(wasi.ERRNO_NOSPC)
    expect(write(second.fd, ['x'])).toBe(0)
    expect(imports.fd_filestat_set_size!(first.fd, 1n)).toBe(0)
    expect(write(second.fd, ['yz'])).toBe(0)
    expect(text(fs.read('/work/two'))).toBe('xyz')
    expect(open('work/one', wasi.OFLAGS_TRUNC).ret).toBe(0)
    expect(write(second.fd, ['!'])).toBe(0)
    expect(text(fs.read('/work/two'))).toBe('xyz!')
  })

  it('charges unlinked open files until close, including writes after unlink', () => {
    const { fs, open, operation, imports, write } = fixture({ workspaceBytes: 4, maxWorkspaceEntries: 1 })
    const file = open('work/file')
    expect(write(file.fd, ['123'])).toBe(0)
    expect(operation('path_unlink_file', 'work/file')).toBe(0)
    expect(fs.list('/work')).toEqual([])
    expect(open('work/new').ret).toBe(wasi.ERRNO_NOSPC)
    expect(write(file.fd, ['4'])).toBe(0)
    expect(write(file.fd, ['5'])).toBe(wasi.ERRNO_NOSPC)
    expect(imports.fd_renumber!(file.fd, file.fd)).toBe(0)
    expect(imports.fd_close!(file.fd)).toBe(0)
    expect(imports.fd_close!(file.fd)).toBe(wasi.ERRNO_BADF)
    fs.write('/work/new', bytes('1234'))
    expect(text(fs.read('/work/new'))).toBe('1234')
  })

  it('retains an unlinked directory entry until close and refuses creation through it', () => {
    const { fs, open, operation, imports } = fixture({ maxWorkspaceEntries: 1 })
    fs.mkdir('/work/directory')
    const directory = open('work/directory', wasi.OFLAGS_DIRECTORY, 0n)
    expect(operation('path_remove_directory', 'work/directory')).toBe(0)
    expect(operation('path_create_directory', 'hidden', directory.fd)).toBe(wasi.ERRNO_NOENT)
    expect(open('work/new').ret).toBe(wasi.ERRNO_NOSPC)
    expect(imports.fd_close!(directory.fd)).toBe(0)
    expect(open('work/new').ret).toBe(0)
  })

  it('releases overwritten unlinked descriptors when renumbering and preserves the moved file', () => {
    const { fs, open, imports, operation, write } = fixture({ workspaceBytes: 4, maxWorkspaceEntries: 2 })
    const old = open('work/old')
    const current = open('work/current')
    expect(write(old.fd, ['123'])).toBe(0)
    expect(operation('path_unlink_file', 'work/old')).toBe(0)
    expect(imports.fd_renumber!(current.fd, old.fd)).toBe(0)
    expect(write(old.fd, ['abcd'])).toBe(0)
    expect(imports.fd_close!(current.fd)).toBe(wasi.ERRNO_BADF)
    expect(text(fs.read('/work/current'))).toBe('abcd')
    expect(imports.fd_close!(old.fd)).toBe(0)
    fs.remove('/work/current')
    fs.write('/work/reused', bytes('1234'))
    expect(text(fs.read('/work/reused'))).toBe('1234')
  })

  it('reuses closed descriptors and bounds simultaneous opens independently of inode count', () => {
    const { open, imports, runtime } = fixture({ maxWorkspaceEntries: 1 })
    const first = open('candidate/main.py', 0, 0n)
    expect(first.ret).toBe(0)
    for (let i = 0; i < 59; i++) expect(open('candidate/main.py', 0, 0n).ret).toBe(0)
    expect(open('candidate/main.py', 0, 0n).ret).toBe(wasi.ERRNO_MFILE)
    for (let i = 0; i < 20; i++) {
      expect(imports.fd_close!(first.fd)).toBe(0)
      expect(open('candidate/main.py', 0, 0n)).toEqual(first)
    }
    expect(runtime.fds).toHaveLength(64)
  })

  it('rejects guest traversal and Windows host paths through path_open', () => {
    const { open, fs } = fixture()
    for (const path of ['../secret', '/etc/passwd', 'C:\\Windows\\win.ini', 'work/../../../secret', 'work/null\0name']) {
      expect(open(path).ret).toBe(wasi.ERRNO_NOTCAPABLE)
    }
    expect(fs.list('/work')).toEqual([])
    expect(open('work/file').ret).toBe(0)
    expect(open('work/file', wasi.OFLAGS_CREAT | wasi.OFLAGS_EXCL).ret).toBe(wasi.ERRNO_EXIST)
    expect(open('work/file', wasi.OFLAGS_DIRECTORY).ret).toBe(wasi.ERRNO_NOTDIR)
  })

  it('rejects invalid guest write buffers before any data or quota changes', () => {
    const { open, imports, fs, view, memory } = fixture()
    const file = open('work/file')
    view.setUint32(512, memory.buffer.byteLength, true)
    view.setUint32(516, 1, true)
    expect(imports.fd_write!(file.fd, 512, 1, 24)).toBe(wasi.ERRNO_FAULT)
    expect(imports.fd_write!(file.fd, 512, 0xffffffff, 24)).toBe(wasi.ERRNO_FAULT)
    expect(imports.fd_write!(file.fd, -1, 1, 24)).toBe(wasi.ERRNO_FAULT)
    expect(imports.fd_write!(file.fd, 512, 1, memory.buffer.byteLength)).toBe(wasi.ERRNO_FAULT)
    expect(imports.fd_write!(999, 512, 1, 24)).toBe(wasi.ERRNO_BADF)
    expect(fs.read('/work/file')).toHaveLength(0)
  })

  it('renames within one writable root atomically and retains replaced open-file quota', () => {
    const { fs, open, rename, imports } = fixture({ workspaceBytes: 8, maxWorkspaceEntries: 3 })
    fs.write('/work/from', bytes('1234'))
    fs.write('/work/to', bytes('5678'))
    const target = open('work/to', 0, 0n)
    expect(rename('work/from', 'work/to')).toBe(0)
    expect(fs.list('/work')).toEqual(['to'])
    expect(text(fs.read('/work/to'))).toBe('1234')
    expect(() => { fs.write('/work/new', bytes('x')) }).toThrow()
    expect(imports.fd_close!(target.fd)).toBe(0)
    fs.write('/work/new', bytes('abcd'))
    expect(rename('work/new', 'tmp/new')).toBe(wasi.ERRNO_XDEV)
    expect(rename('work/to', 'candidate/main.py')).toBe(wasi.ERRNO_ROFS)
    expect(text(fs.read('/work/new'))).toBe('abcd')
    fs.remove('/work/new')
    fs.mkdir('/work/dir')
    fs.mkdir('/work/dir/child')
    expect(rename('work/dir', 'work/dir/child/cycle')).toBe(wasi.ERRNO_INVAL)
    expect(rename('work/dir', 'work/renamed')).toBe(0)
    expect(fs.list('/work/renamed')).toEqual(['child'])
  })

  it.each([
    { path: '/work/unsafe name', budget: {}, pattern: /artifact path/ },
    { path: '/work/中文', budget: {}, pattern: /artifact path/ },
    { path: `/work/${'a'.repeat(241)}`, budget: {}, pattern: /artifact path/ },
    { path: '/work/two', budget: { maxArtifactFiles: 1 }, pattern: /artifact budget/ },
    { path: '/work/two', budget: { maxArtifactBytes: 3 }, pattern: /artifact budget/ },
  ])('enforces complete artifact constraints for $path', ({ path, budget, pattern }) => {
    const { fs } = fixture(budget)
    fs.write('/work/one', bytes('ab'))
    fs.write(path, bytes('cd'))
    expect(() => fs.artifacts()).toThrow(pattern)
  })

  it('ignores empty directories and validates nested paths when files are exported', () => {
    const { fs } = fixture({ maxArtifactFiles: 1, maxArtifactBytes: 4 })
    fs.mkdir('/work/empty space')
    fs.write('/work/exact', bytes('1234'))
    expect(fs.artifacts()).toEqual([{ path: 'exact', base64: Buffer.from('1234').toString('base64') }])
    fs.write('/work/empty space/file', bytes(''))
    expect(() => fs.artifacts()).toThrow('artifact path')
  })

  it('preserves byte quota after direct guarded descriptor operations', () => {
    const { fs, open, runtime } = fixture({ workspaceBytes: 4 })
    const { fd } = open('work/file')
    const descriptor = runtime.fds[fd]
    if (!(descriptor instanceof OpenFile) || !(descriptor.file instanceof File)) throw new Error('Missing regular file')
    expect(descriptor.fd_pwrite(bytes('abc'), 0n)).toEqual({ ret: 0, nwritten: 3 })
    expect(descriptor.fd_pwrite(bytes('ab'), 3n)).toEqual({ ret: wasi.ERRNO_NOSPC, nwritten: 0 })
    expect(descriptor.fd_filestat_set_size(5n)).toBe(wasi.ERRNO_NOSPC)
    expect(text(fs.read('/work/file'))).toBe('abc')
  })
})
