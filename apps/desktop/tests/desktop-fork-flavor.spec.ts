import { describe, expect, it } from 'vitest'
import { forkPackageEnvironment, resolveDesktopForkFlavor } from '../scripts/desktop-fork-flavor.mjs'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const flavor = { DSH_DESKTOP_FORK_FLAVOR: 'harness2' }
const target = { platform: 'win32', arch: 'x64' } as const

describe('custom Harness² Desktop packaging', () => {
  it('requires explicit recognized selection', () => {
    expect(resolveDesktopForkFlavor({})).toBeUndefined()
    expect(resolveDesktopForkFlavor(flavor)).toBe('harness2')
    expect(() => resolveDesktopForkFlavor({ DSH_DESKTOP_FORK_FLAVOR: '' })).toThrow('unsupported fork flavor')
    expect(() => forkPackageEnvironment({})).toThrow('explicit harness2')
  })

  it('never reads preset or dotenv settings and strips release inputs', () => {
    const parent = {
      ...flavor, PATH: 'build-tools', HTTPS_PROXY: 'https://proxy.example',
      DSH_PACKAGING_PRESET: 'production', DSH_PACKAGING_CONFIG_DIR: '/missing-secret-directory',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'do-not-inherit', CSC_LINK: '/missing-certificate',
      DOWNLOAD_TEST_COS_SECRET_KEY: 'do-not-inherit', APPLE_API_KEY: '/missing-key',
      PACKAGE_TEST_RELEASE_ID: 'do-not-inherit', DSH_DESKTOP_UPDATE_CHANNEL: 'latest',
      DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'invalid-json', DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    }
    const selected = loadDesktopPackageEnvironment('win32', parent, '/missing-app-directory', { unsigned: true })
    expect(selected).toEqual({ ...flavor, PATH: 'build-tools', HTTPS_PROXY: 'https://proxy.example',
      DSH_DESKTOP_APP_ID: 'local.harness2.desktop', DSH_DESKTOP_UNSIGNED: '1' })
    expect(() => { validateDesktopPackageEnvironment(selected, target, { unsigned: true }) }).not.toThrow()
    expect(parent.DSH_DESKTOP_WINDOWS_TOKEN_PIN).toBe('do-not-inherit')
  })

  it('rejects signed, preparation-only, unsupported architecture, and official identity', () => {
    expect(() => loadDesktopPackageEnvironment('win32', flavor, '/missing', {})).toThrow('requires --unsigned')
    expect(() => loadDesktopPackageEnvironment('win32', flavor, '/missing', { prepareOnly: true })).toThrow('requires --unsigned')
    expect(() => loadDesktopPackageEnvironment('darwin', flavor, '/missing', { unsigned: true })).toThrow('Windows x64')
    const selected = forkPackageEnvironment(flavor)
    expect(() => { validateDesktopPackageEnvironment(selected, target) }).toThrow('requires --unsigned')
    expect(() => { validateDesktopPackageEnvironment(selected, { ...target, arch: 'arm64' }, { unsigned: true }) }).toThrow('Windows x64')
    expect(() => { validateDesktopPackageEnvironment({ ...selected, DSH_DESKTOP_APP_ID: 'com.deepseek.harness' }, target, { unsigned: true }) }).toThrow('isolated application ID')
  })

  it('isolates installer and uninstall identity without policy, update feeds, or protocol takeover', () => {
    const selected = forkPackageEnvironment(flavor)
    const config = createElectronBuilderConfig(selected, 'win32', 'x64')
    expect(config.appId).toBe('local.harness2.desktop')
    expect(config.productName).toBe('Harness2 Desktop Custom')
    expect(config.extraMetadata.name).toBe('harness2-desktop-custom')
    expect(config.extraMetadata.dshDesktopForkFlavor).toBe('harness2')
    expect(config.extraMetadata.dshMandatoryUpdatePolicy).toBeUndefined()
    expect(config.protocols).toEqual([])
    expect(config.publish).toBeNull()
    expect(config.win.forceCodeSigning).toBe(false)
    expect(config.win.signtoolOptions.sign).toBeUndefined()
    expect(config.artifactName).toBe('harness2-desktop-${version}-${os}-${arch}-unsigned.${ext}')
    expect(() => createElectronBuilderConfig({ ...selected, DSH_DESKTOP_UNSIGNED: '0' }, 'win32', 'x64')).toThrow('requires unsigned')
    expect(() => createElectronBuilderConfig(selected, 'darwin', 'arm64')).toThrow('Windows x64')
  })
})
