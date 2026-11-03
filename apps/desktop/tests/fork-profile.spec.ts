import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { desktopProfileBundles } from '../src/fork-profile.ts'
import { createPluginProfile } from '../src/project-manager.ts'

describe('custom Harness² desktop composition', () => {
  it('inherits the same built-in bundles in both flavors and preserves existing profiles', () => {
    expect(desktopProfileBundles()).toEqual(PROFILE_TEMPLATES.web?.bundles)
    expect(desktopProfileBundles(true)).toEqual(desktopProfileBundles())
    expect(desktopProfileBundles(true)).not.toBe(PROFILE_TEMPLATES.web?.bundles)
    expect(desktopProfileBundles(true)).not.toContain('@deepseek-ai/dsh-experimental-harness2-bundle')
    const root = mkdtempSync(join(tmpdir(), 'harness2-profile-'))
    onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
    createPluginProfile(root, desktopProfileBundles(true))
    const file = join(root, 'package.json')
    const initial = readFileSync(file, 'utf8')
    expect((JSON.parse(initial) as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles)
      .toEqual(desktopProfileBundles())
    createPluginProfile(root)
    expect(readFileSync(file, 'utf8')).toBe(initial)
  })

  it('inherits the native engine and preset tools while disabling custom product telemetry', () => {
    const base = loadOverlayPatches('desktop', 'packages/bundle/base/cordis.patch.yml')
    const web = loadOverlayPatches('desktop', 'packages/bundle/web-app/cordis.patch.yml')
    const presets = ['standard', 'cordis', 'ptc'].map(preset => (
      loadOverlayPatches('desktop', `packages/bundle/web-app/presets/${preset}.patch.yml`)
    ))
    const privacy = loadOverlayPatches('desktop', 'apps/desktop-host/config/harness2.patch.yml')
    const warnings: string[] = []
    const rows = composeEntries([base, web, ...presets, privacy], (warning) => { warnings.push(warning) })
    for (const id of ['desktop-product-telemetry', 'product-analytics']) {
      expect(rows.find(row => row.id === id)?.disabled).toBe(true)
    }
    const engine = rows.find(row => row.id === 'optional-harness2')
    expect(engine?.name).toBe('@deepseek-ai/dsh-harness2')
    expect(engine?.disabled ?? false).toBe(false)
    expect(engine?.config).toEqual(composeEntries([base]).find(row => row.id === 'optional-harness2')?.config)
    expect(rows.find(row => row.id === 'optional-tool-harness2')).toMatchObject({
      name: '@deepseek-ai/dsh-tool-harness2', disabled: true,
    })
    const consumer: unknown = expect.objectContaining({
      id: 'optional-tool-harness2', name: '@deepseek-ai/dsh-tool-harness2',
    })
    const matchingTools: unknown = expect.arrayContaining([consumer])
    for (const preset of ['standard', 'cordis', 'ptc']) {
      expect(rows.find(row => row.id === `preset-${preset}`)).toMatchObject({
        config: { plugins: matchingTools },
      })
    }
    expect(warnings.filter(warning => /product-analytics|desktop-product-telemetry/u.test(warning))).toEqual([])
  })
})
