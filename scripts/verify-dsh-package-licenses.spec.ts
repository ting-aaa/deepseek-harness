import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectDshPackageLicenses } from './verify-dsh-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@deepseek-ai/dsh-root',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

describe('DSH package license gate', () => {
  it('checks root, unhyphenated CLI, and dsh-prefixed package names while ignoring other families', () => {
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: '@deepseek-ai/dsh', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@deepseek-ai/dsh-agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@deepseek-ai/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectDshPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@deepseek-ai/dsh-agent' })

    expect(inspectDshPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @deepseek-ai/dsh-agent must declare "license": "MIT"; found undefined.',
    ])
  })
})

function createHarness2(root: string): string {
  const directory = 'packages/experimental/harness2'
  writeManifest(root, `${directory}/package.json`, {
    name: '@deepseek-ai/dsh-experimental-harness2', license: '(MIT AND Apache-2.0)', files: ['NOTICE'],
  })
  for (const file of ['LICENSE', 'NOTICE']) {
    writeFileSync(join(root, directory, file), readFileSync(join(import.meta.dirname, '..', directory, file)))
  }
  return join(root, directory)
}

describe('Harness² translated-source exception', () => {
  it('admits only the attributed mixed-license package with complete distributable notices', () => {
    const root = createWorkspace()
    createHarness2(root)
    expect(inspectDshPackageLicenses(root)).toEqual({ packageCount: 2, failures: [] })
  })

  it.each(['packages/experimental/other', 'packages/core/harness2'])('does not extend the exception to %s', (directory) => {
    const root = createWorkspace()
    writeManifest(root, `${directory}/package.json`, {
      name: '@deepseek-ai/dsh-experimental-harness2', license: '(MIT AND Apache-2.0)',
    })
    expect(inspectDshPackageLicenses(root).failures[0]).toContain('must declare "license": "MIT"')
  })

  it('does not extend the exception to another identity at the same path', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/experimental/harness2/package.json', {
      name: '@deepseek-ai/dsh-other', license: '(MIT AND Apache-2.0)',
    })
    expect(inspectDshPackageLicenses(root).failures[0]).toContain('must declare "license": "MIT"')
  })

  it.each(['MIT', 'Apache-2.0', '(MIT OR Apache-2.0)'])('rejects incorrect attribution scope %s', (license) => {
    const root = createWorkspace()
    createHarness2(root)
    writeManifest(root, 'packages/experimental/harness2/package.json', {
      name: '@deepseek-ai/dsh-experimental-harness2', license, files: ['NOTICE'],
    })
    expect(inspectDshPackageLicenses(root).failures[0]).toContain('must declare "license": "(MIT AND Apache-2.0)"')
  })

  it.each(['LICENSE', 'NOTICE'])('rejects missing %s', (file) => {
    const root = createWorkspace()
    const directory = createHarness2(root)
    rmSync(join(directory, file))
    expect(inspectDshPackageLicenses(root).failures).toHaveLength(1)
    expect(inspectDshPackageLicenses(root).failures[0]).toContain(`${file}: missing`)
  })

  it.each(['LICENSE', 'NOTICE'])('rejects incomplete %s', (file) => {
    const root = createWorkspace()
    const directory = createHarness2(root)
    writeFileSync(join(directory, file), 'MIT License')
    expect(inspectDshPackageLicenses(root).failures).toHaveLength(1)
    expect(inspectDshPackageLicenses(root).failures[0]).toContain(`${file}:`)
  })

  it('rejects notice omission from the publication allowlist', () => {
    const root = createWorkspace()
    createHarness2(root)
    writeManifest(root, 'packages/experimental/harness2/package.json', {
      name: '@deepseek-ai/dsh-experimental-harness2', license: '(MIT AND Apache-2.0)', files: ['lib/index.js'],
    })
    expect(inspectDshPackageLicenses(root).failures[0]).toContain('published files must include NOTICE')
  })
})
