/** Publication retry tests use operation-local filesystem and delay adapters without real waits. */
import { describe, expect, it, vi } from 'vitest'
import { publishDevtoolsDirectory } from '../scripts/devtools/publication.ts'

const temporary = '/frontend/lib/devtools.build-private'
const output = '/frontend/lib/devtools'

describe('DevTools directory publication', () => {
  it('publishes the complete directory without waiting when rename succeeds', async () => {
    const rename = vi.fn(async () => {})
    const wait = vi.fn(async () => {})
    await publishDevtoolsDirectory(temporary, output, { platform: 'win32', rename, wait })
    expect(rename.mock.calls).toEqual([[temporary, output]])
    expect(wait).not.toHaveBeenCalled()
  })

  it('retries transient Windows interference on the same complete directory', async () => {
    const failures = ['EACCES', 'EBUSY', 'EPERM']
    const rename = vi.fn(async () => {
      const code = failures.shift()
      if (code !== undefined) throw Object.assign(new Error('injected rename interference'), { code })
    })
    const wait = vi.fn(async () => {})
    await publishDevtoolsDirectory(temporary, output, { platform: 'win32', rename, wait })
    expect(rename.mock.calls).toEqual(Array.from({ length: 4 }, () => [temporary, output]))
    expect(wait.mock.calls).toEqual([[20], [40], [80]])
  })

  it.each(['EACCES', 'EBUSY', 'EPERM'])('rethrows %s after eight bounded Windows retries', async (code) => {
    const failure = Object.assign(new Error('injected persistent rename interference'), { code })
    const rename = vi.fn(async () => { throw failure })
    const wait = vi.fn(async () => {})
    await expect(publishDevtoolsDirectory(temporary, output, { platform: 'win32', rename, wait })).rejects.toBe(failure)
    expect(rename.mock.calls).toEqual(Array.from({ length: 9 }, () => [temporary, output]))
    expect(wait.mock.calls).toEqual([[20], [40], [80], [160], [200], [200], [200], [200]])
  })

  it.each(['ENOENT', 'EIO', 'EXDEV', undefined])('immediately rethrows a Windows rename failure with code %s', async (code) => {
    const failure = Object.assign(new Error('injected non-transient failure'), { code })
    const rename = vi.fn(async () => { throw failure })
    const wait = vi.fn(async () => {})
    await expect(publishDevtoolsDirectory(temporary, output, { platform: 'win32', rename, wait })).rejects.toBe(failure)
    expect(rename.mock.calls).toEqual([[temporary, output]])
    expect(wait).not.toHaveBeenCalled()
  })

  it.each([
    ['linux', 'EACCES'], ['linux', 'EBUSY'], ['linux', 'EPERM'],
    ['darwin', 'EACCES'], ['darwin', 'EBUSY'], ['darwin', 'EPERM'],
  ] as const)('immediately rethrows %s rename failure %s', async (platform, code) => {
    const failure = Object.assign(new Error('injected non-Windows failure'), { code })
    const rename = vi.fn(async () => { throw failure })
    const wait = vi.fn(async () => {})
    await expect(publishDevtoolsDirectory(temporary, output, { platform, rename, wait })).rejects.toBe(failure)
    expect(rename.mock.calls).toEqual([[temporary, output]])
    expect(wait).not.toHaveBeenCalled()
  })
})
