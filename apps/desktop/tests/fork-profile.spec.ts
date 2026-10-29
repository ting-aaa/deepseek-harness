import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { desktopProfileBundles, HARNESS2_DESKTOP_BUNDLE } from '../src/fork-profile.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import { selectDesktopPackageClosure, type PackedDesktopPackage } from '../scripts/prepare-package-set.ts'

describe('custom Harness² desktop composition', () => {
  it('selects the extra bundle only for the custom profile and preserves existing profiles', () => {
    expect(desktopProfileBundles()).not.toContain(HARNESS2_DESKTOP_BUNDLE)
    expect(desktopProfileBundles(true)).toEqual([...desktopProfileBundles(), HARNESS2_DESKTOP_BUNDLE])
    const root = mkdtempSync(join(tmpdir(), 'harness2-profile-'))
    try {
      createPluginProfile(root, desktopProfileBundles(true))
      const file = join(root, 'package.json')
      const initial = readFileSync(file, 'utf8')
      expect((JSON.parse(initial) as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles).toContain(HARNESS2_DESKTOP_BUNDLE)
      createPluginProfile(root)
      expect(readFileSync(file, 'utf8')).toBe(initial)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('includes the custom bundle dependency closure, never arbitrary devDependencies', () => {
    const packed = (name: string, dependencies: Record<string, string> = {}): PackedDesktopPackage => ({
      tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', dependencies },
    })
    const service = '@deepseek-ai/dsh-experimental-harness2'
    const tool = '@deepseek-ai/dsh-experimental-tool-harness2'
    const subagent = '@deepseek-ai/dsh-subagent'
    const core = '@deepseek-ai/dsh-agent'
    const available = new Map([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host')],
      [HARNESS2_DESKTOP_BUNDLE, packed(HARNESS2_DESKTOP_BUNDLE, { [service]: '1', [tool]: '1' })],
      [service, packed(service, { [subagent]: '1', [core]: '1' })],
      [tool, packed(tool)], [subagent, packed(subagent)], [core, packed(core)],
      ['unused-development-package', packed('unused-development-package')],
    ])
    const target = { platform: 'win32', arch: 'x64' } as const
    expect(selectDesktopPackageClosure(available, target)).toHaveLength(2)
    const names = selectDesktopPackageClosure(available, target, true).map(entry => entry.manifest.name)
    expect(names).toEqual(expect.arrayContaining([HARNESS2_DESKTOP_BUNDLE, service, tool, subagent, core]))
    expect(names).not.toContain('unused-development-package')
    available.delete(HARNESS2_DESKTOP_BUNDLE)
    expect(() => selectDesktopPackageClosure(available, target, true)).toThrow(HARNESS2_DESKTOP_BUNDLE)
  })

  it('disables both official product telemetry rows in the custom Host overlay', () => {
    const web = loadOverlayPatches('desktop', 'packages/bundle/web-app/cordis.patch.yml')
    const harness2 = loadOverlayPatches('desktop', 'packages/experimental/harness2-bundle/cordis.patch.yml')
    const privacy = loadOverlayPatches('desktop', 'apps/desktop-host/config/harness2.patch.yml')
    const warnings: string[] = []
    const rows = composeEntries([web, harness2, privacy], (warning) => { warnings.push(warning) })
    for (const id of ['desktop-product-telemetry', 'product-analytics']) {
      expect(rows.find(row => row.id === id)?.disabled).toBe(true)
    }
    expect(rows.find(row => row.id === 'optional-harness2')?.name).toBe('@deepseek-ai/dsh-experimental-harness2')
    expect(rows.find(row => row.id === 'optional-tool-harness2')?.name).toBe('@deepseek-ai/dsh-experimental-tool-harness2')
    expect(warnings.filter(warning => /product-analytics|desktop-product-telemetry/u.test(warning))).toEqual([])
  })

  it('keeps candidate code execution disabled in the bundled layer', () => {
    const patch = readFileSync('packages/experimental/harness2-bundle/cordis.patch.yml', 'utf8')
    expect(patch).not.toMatch(/runtime:/u)
    expect(readFileSync('packages/experimental/harness2/src/index.ts', 'utf8')).toContain('runtime: null')
  })
})
