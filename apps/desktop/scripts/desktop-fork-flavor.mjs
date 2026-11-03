/** Explicit local-only Desktop distribution identity; never consumes release credentials. */

/**
 * Resolve the requested custom distribution.
 * @param {NodeJS.ProcessEnv} environment Packaging environment.
 * @returns {'harness2' | undefined} Explicit fork flavor, or the unchanged upstream distribution.
 */
export function resolveDesktopForkFlavor(environment = process.env) {
  const flavor = environment.DSH_DESKTOP_FORK_FLAVOR
  if (flavor !== undefined && flavor !== 'harness2') throw new Error('desktop package: unsupported fork flavor')
  return flavor
}

/**
 * Select the custom unsigned distribution without reading release configuration files.
 * @param {NodeJS.ProcessEnv} environment Parent build-tool and networking environment.
 * @returns {NodeJS.ProcessEnv} Custom identity without signing, publishing, or update inputs.
 */
export function forkPackageEnvironment(environment = process.env) {
  if (resolveDesktopForkFlavor(environment) !== 'harness2') throw new Error('desktop package: explicit harness2 fork flavor required')
  const releaseSetting = /^(?:DSH_DESKTOP_(?:APP_ID|AUTO_UPDATE_.*|UPDATE_.*|MANDATORY_UPDATE_.*|WINDOWS_.*|MACOS_.*)|DSH_PACKAGING_.*|APPLE_.*|(?:WIN_)?CSC_.*|DOWNLOAD_.*|PACKAGE_.*)$/iu
  return {
    ...Object.fromEntries(Object.entries(environment).filter(([name]) => !releaseSetting.test(name))),
    DSH_DESKTOP_FORK_FLAVOR: 'harness2',
    DSH_DESKTOP_APP_ID: 'local.harness2.desktop',
    DSH_DESKTOP_UNSIGNED: '1',
  }
}
