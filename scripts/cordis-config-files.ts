/** Cordis Loader configuration file discovery. */

import { spawnSync } from 'node:child_process'
import { globSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { readGitIndexBlob } from './translation-pairing-git.ts'

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
}

/**
 * Read current Loader YAML, resolving exact tracked link blobs from checkouts without native symlinks.
 * Ordinary files remain YAML input even when their text names another file.
 * @param root - Repository root used to confirm Git symlink modes.
 * @param file - Repository-relative Loader configuration path.
 * @returns Current target text for a tracked link blob, otherwise current file text.
 * @throws When a confirmed link is cyclic, leaves the repository, or has an unreadable target.
 */
export function readCordisConfig(root: string, file: string): string {
  const visited = new Set<string>()
  let path = resolve(root, file)
  while (true) {
    if (visited.has(path)) throw new Error(`${file}: tracked Cordis config symlink cycle`)
    visited.add(path)
    const source = readFileSync(path, 'utf8')
    if (lstatSync(path).isSymbolicLink() || /[\r\n]/.test(source)) return source
    const repoPath = relative(root, path).split(sep).join('/')
    const index = spawnSync('git', ['--literal-pathspecs', '-C', root, 'ls-files', '--stage', '-z', '--', repoPath])
    if (index.status !== 0) return source
    const entries = index.stdout.toString('utf8').split('\0').filter(Boolean)
    if (entries.length !== 1 || !/^120000 [0-9a-f]+ 0\t/.test(entries[0] ?? '')) return source
    const target = readGitIndexBlob(root, repoPath)?.toString('utf8')
    if (target !== source) return source
    path = resolve(dirname(path), target)
    const destination = relative(root, path)
    if (destination === '..' || destination.startsWith(`..${sep}`) || isAbsolute(destination)) {
      throw new Error(`${file}: tracked Cordis config symlink target leaves the repository`)
    }
  }
}
