/** Built-in distribution metadata and function-plugin exports use the real profile resolver and Loader. */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, initProfile, loadProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import * as ToolHarness2 from '@deepseek-ai/dsh-tool-harness2'

it('resolves the published base bundle to its built-in engine and consumer rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness2-bundle-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const source = fileURLToPath(new URL('../../../bundle/base/', import.meta.url))
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    name: string
    dsh: { bundle: { patch: string } }
  }
  expect(manifest.name).toBe('@deepseek-ai/dsh-base')
  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  const profileDir = join(root, 'profiles', 'test')
  const anchor = join(root, 'package.json')
  await writeFile(anchor, JSON.stringify({ name: 'test-installation' }))
  initProfile(profileDir, [manifest.name, '@deepseek-ai/dsh-experimental-harness2-bundle'])
  await writeFile(join(profileDir, 'cordis.patch.yml'), JSON.stringify([
    { id: 'optional-harness2', config: { maxK: 2 } },
  ]))
  const packages = join(profileDir, 'node_modules', '@deepseek-ai')
  await mkdir(packages, { recursive: true })
  await symlink(source, join(packages, 'dsh-base'), process.platform === 'win32' ? 'junction' : 'dir')
  const profile = loadProfileDirectory('test', profileDir, anchor)
  expect(profile.layers.map(layer => layer.packageName)).toEqual([manifest.name])
  expect(profile.layers[0]?.patches.flatMap(patch => patch.insert ?? [])
    .filter(entry => ['optional-harness2', 'optional-tool-harness2'].includes(entry.id)).map(entry => entry.name)).toEqual([
    '@deepseek-ai/dsh-harness2', '@deepseek-ai/dsh-tool-harness2',
  ])
  const saved = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
    dsh: { profile: { bundles: string[] } }
  }
  expect(saved.dsh.profile.bundles).toEqual([manifest.name])
  const entries = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  expect(entries.find(entry => entry.id === 'optional-harness2')).toMatchObject({
    name: '@deepseek-ai/dsh-harness2', config: { maxK: 2 },
  })
})

it('preserves the tool consumer namespace through Loader export unwrapping', () => {
  expect('default' in ToolHarness2).toBe(false)
  const loader = Object.create(Loader.prototype) as Loader
  expect(loader.unwrapExports(ToolHarness2)).toBe(ToolHarness2)
  expect(ToolHarness2.inject).toEqual(['harness2', 'tools'])
})

it.each(['acp', 'web', 'headless', 'sdk', 'sdk-minimal'])(
  'composes the real %s profile with its intended Harness² scope', async (name) => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-harness2-profile-'))
    onTestFinished(async () => { await rm(home, { recursive: true, force: true }) })
    const anchor = join(home, 'package.json')
    await writeFile(anchor, JSON.stringify({ name: 'harness2-profile-installation' }))
    const modules = join(home, 'node_modules', '@deepseek-ai')
    await mkdir(modules, { recursive: true })
    for (const bundle of ['base', 'acp-app', 'web-app', 'headless', 'sdk-app', 'sdk-minimal']) {
      const source = fileURLToPath(new URL(`../../../bundle/${bundle}/`, import.meta.url))
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { name: string }
      await symlink(source, join(modules, manifest.name.slice('@deepseek-ai/'.length)),
        process.platform === 'win32' ? 'junction' : 'dir')
    }
    const profile = loadProfile('harness2-test', name, anchor, home)
    const entries = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
    const engine = entries.find(entry => entry.name === '@deepseek-ai/dsh-harness2')
    const consumer = entries.find(entry => entry.name === '@deepseek-ai/dsh-tool-harness2')
    if (name === 'sdk-minimal') {
      expect(engine).toBeUndefined()
      expect(consumer).toBeUndefined()
      return
    }
    expect(engine).toMatchObject({ id: 'optional-harness2' })
    expect(engine?.disabled ?? false).toBe(false)
    expect(consumer).toMatchObject({ id: 'optional-tool-harness2' })
    expect(consumer?.disabled ?? false).toBe(name === 'web')
    if (name !== 'web') return
    const tool: unknown = expect.objectContaining({
      id: 'optional-tool-harness2', name: '@deepseek-ai/dsh-tool-harness2',
    })
    const matchingTools: unknown = expect.arrayContaining([tool])
    for (const preset of ['standard', 'cordis', 'ptc']) {
      expect(entries.find(entry => entry.id === `preset-${preset}`)).toMatchObject({
        config: { plugins: matchingTools },
      })
    }
    const minimal = entries.find(entry => entry.id === 'preset-minimal')
    expect(minimal).toMatchObject({ config: { id: 'minimal' } })
    const minimalConfig: unknown = minimal?.config
    const minimalPlugins = typeof minimalConfig === 'object' && minimalConfig !== null && 'plugins' in minimalConfig
      ? minimalConfig.plugins : undefined
    expect(Array.isArray(minimalPlugins)).toBe(true)
    expect(minimalPlugins).not.toEqual(matchingTools)
  },
)
