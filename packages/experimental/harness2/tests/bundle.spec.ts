/** Optional distribution metadata and function-plugin exports are consumed by the real profile resolver and Loader. */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { initProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import * as ToolHarness2 from '@deepseek-ai/dsh-experimental-tool-harness2'

it('resolves the published opt-in bundle to its actual engine and consumer rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harness2-bundle-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const source = fileURLToPath(new URL('../../harness2-bundle/', import.meta.url))
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    name: string
    dsh: { bundle: { patch: string; listedByDefault: boolean } }
  }
  expect(manifest.dsh.bundle).toEqual({ patch: './cordis.patch.yml', listedByDefault: false })
  const profileDir = join(root, 'profiles', 'test')
  const anchor = join(root, 'package.json')
  await writeFile(anchor, JSON.stringify({ name: 'test-installation' }))
  initProfile(profileDir, [manifest.name])
  const packages = join(profileDir, 'node_modules', '@deepseek-ai')
  await mkdir(packages, { recursive: true })
  await symlink(source, join(packages, 'dsh-experimental-harness2-bundle'), process.platform === 'win32' ? 'junction' : 'dir')
  const profile = loadProfileDirectory('test', profileDir, anchor)
  expect(profile.layers.map(layer => layer.packageName)).toEqual([manifest.name])
  expect(profile.layers[0]?.patches.flatMap(patch => patch.insert ?? []).map(entry => entry.name)).toEqual([
    '@deepseek-ai/dsh-experimental-harness2', '@deepseek-ai/dsh-experimental-tool-harness2',
  ])
})

it('preserves the tool consumer namespace through Loader export unwrapping', () => {
  expect('default' in ToolHarness2).toBe(false)
  const loader = Object.create(Loader.prototype) as Loader
  expect(loader.unwrapExports(ToolHarness2)).toBe(ToolHarness2)
  expect(ToolHarness2.inject).toEqual(['harness2', 'tools'])
})
