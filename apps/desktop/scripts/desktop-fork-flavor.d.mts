/** Explicit local-only Desktop distribution identity; never consumes release credentials. */

/**
 * Resolve the requested custom distribution.
 * @param environment Packaging environment.
 * @returns Explicit fork flavor, or the unchanged upstream distribution.
 */
export function resolveDesktopForkFlavor(environment?: NodeJS.ProcessEnv): 'harness2' | undefined

/**
 * Select the custom unsigned distribution without reading release configuration files.
 * @param environment Parent build-tool and networking environment.
 * @returns Custom identity without signing, publishing, or update inputs.
 */
export function forkPackageEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
