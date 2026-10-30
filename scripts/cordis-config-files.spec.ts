import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles, readCordisConfig } from './cordis-config-files.ts'
import { loadCordisYaml } from './cordis-yaml.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', root, ...args], { input, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function gitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-link-'))
  roots.push(root)
  git(root, ['init', '--quiet'])
  return root
}

function trackedLinkBlob(root: string, file: string, target: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), target)
  const blob = git(root, ['hash-object', '-w', '--stdin'], target)
  git(root, ['update-index', '--add', '--cacheinfo', `120000,${blob},${file}`])
}

describe('cordisConfigFiles', () => {
  it('finds Loader YAML without treating translation records as configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    for (const directory of ['.claude', 'apps/cli/config/examples', 'docs', 'node_modules/pkg', 'vendor/pkg']) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'apps/cli/config/examples/agent.cordis.yaml',
      'apps/cli/config/examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('apps', 'cli', 'config', 'examples', 'agent.cordis.yaml'),
      join('apps', 'cli', 'config', 'examples', 'headless.cordis.yml'),
    ])
  })
})

describe('readCordisConfig', () => {
  it('reads current target YAML from an exact Git-tracked link blob without native symlink privileges', () => {
    const root = gitFixture()
    mkdirSync(join(root, 'snapshots'), { recursive: true })
    writeFileSync(join(root, 'snapshots/target.yml'), '- id: current\n')
    trackedLinkBlob(root, 'profiles/acp/cordis.yml', '../../snapshots/target.yml')

    expect(loadCordisYaml(readCordisConfig(root, 'profiles/acp/cordis.yml'))).toEqual([{ id: 'current' }])
    writeFileSync(join(root, 'snapshots/target.yml'), '- id: edited\n')
    expect(readCordisConfig(root, 'profiles/acp/cordis.yml')).toBe('- id: edited\n')
  })

  it('resolves each tracked link relative to its own directory, including paths with spaces', () => {
    const root = gitFixture()
    mkdirSync(join(root, 'configs'), { recursive: true })
    writeFileSync(join(root, 'configs/final.yml'), '[]\n')
    trackedLinkBlob(root, 'profiles/acp/cordis.yml', '../../shared configs/next.yml')
    trackedLinkBlob(root, 'shared configs/next.yml', '../configs/final.yml')

    expect(readCordisConfig(root, 'profiles/acp/cordis.yml')).toBe('[]\n')
  })

  it('keeps an ordinary scalar config invalid even when its text names valid Loader YAML', () => {
    const root = gitFixture()
    writeFileSync(join(root, 'target.yml'), '[]\n')
    writeFileSync(join(root, 'cordis.yml'), 'target.yml')
    git(root, ['add', '--', 'cordis.yml'])

    expect(readCordisConfig(root, 'cordis.yml')).toBe('target.yml')
    expect(Array.isArray(loadCordisYaml(readCordisConfig(root, 'cordis.yml')))).toBe(false)
  })

  it('does not follow edited regular-file contents that differ from the indexed link blob', () => {
    const root = gitFixture()
    writeFileSync(join(root, 'target.yml'), '[]\n')
    trackedLinkBlob(root, 'cordis.yml', 'original.yml')
    writeFileSync(join(root, 'cordis.yml'), 'target.yml')

    expect(readCordisConfig(root, 'cordis.yml')).toBe('target.yml')
    expect(Array.isArray(loadCordisYaml(readCordisConfig(root, 'cordis.yml')))).toBe(false)
  })

  it('keeps scalar YAML unchanged outside a Git checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-no-git-'))
    roots.push(root)
    writeFileSync(join(root, 'cordis.yml'), 'target.yml')
    writeFileSync(join(root, 'target.yml'), '[]\n')

    expect(Array.isArray(loadCordisYaml(readCordisConfig(root, 'cordis.yml')))).toBe(false)
  })

  it('reports tracked link cycles and missing targets without dropping the config', () => {
    const root = gitFixture()
    trackedLinkBlob(root, 'cordis.yml', 'next.yml')
    trackedLinkBlob(root, 'next.yml', 'cordis.yml')
    expect(() => readCordisConfig(root, 'cordis.yml')).toThrow('symlink cycle')
    trackedLinkBlob(root, 'cordis.yml', 'missing.yml')
    expect(() => readCordisConfig(root, 'cordis.yml')).toThrow('ENOENT')
  })

  it('rejects a confirmed tracked link that leaves the repository', () => {
    const root = gitFixture()
    trackedLinkBlob(root, 'cordis.yml', '../outside.yml')

    expect(() => readCordisConfig(root, 'cordis.yml')).toThrow('leaves the repository')
  })
})
