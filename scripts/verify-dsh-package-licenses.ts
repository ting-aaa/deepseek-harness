/**
 * Enforce MIT declarations, with one source-attributed mixed-license adaptation.
 * @module scripts/verify-dsh-package-licenses
 */

import { createHash } from 'node:crypto'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DSH_PACKAGE_NAME = /^@deepseek-ai\/dsh(?:-|$)/
// Translated Google source retains Apache-2.0 obligations; this is not an alternative license.
const HARNESS2_PACKAGE = 'packages/subagent/harness2/package.json'
const HARNESS2_NAME = '@deepseek-ai/dsh-harness2'
const HARNESS2_LICENSE = '(MIT AND Apache-2.0)'
const DSH_MIT_SHA256 = 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be'
const UPSTREAM_APACHE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
const UPSTREAM_REVISION = '1cfe254e8d25b15f37048c3730134686abe60335'

function inspectHarness2Notices(root: string, manifest: Record<string, unknown>): string[] {
  const failures: string[] = []
  const directory = 'packages/subagent/harness2'
  const licensePath = resolve(root, directory, 'LICENSE')
  const noticePath = resolve(root, directory, 'NOTICE')
  if (!existsSync(licensePath)) failures.push(`${directory}/LICENSE: missing mixed-scope license texts.`)
  else {
    const license = readFileSync(licensePath, 'utf8')
    const apache = license.split('Copyright 2026 Google LLC\n')[1]
    const mit = license.slice(license.indexOf('MIT License\n')).split('\nUpstream Harness2 portions')[0]
    if (apache === undefined || createHash('sha256').update(apache).digest('hex') !== UPSTREAM_APACHE_SHA256
      || mit === undefined || createHash('sha256').update(mit).digest('hex') !== DSH_MIT_SHA256
      || !license.includes('These notices do not relicense')) {
      failures.push(`${directory}/LICENSE: preserve the MIT scope and complete pinned upstream Apache-2.0 text.`)
    }
  }
  if (!existsSync(noticePath)) failures.push(`${directory}/NOTICE: missing upstream attribution.`)
  else {
    const notice = readFileSync(noticePath, 'utf8')
    const required = ['Copyright 2026 Google LLC', 'https://github.com/google-research/harness2', UPSTREAM_REVISION,
      'Apache License, Version 2.0', 'Modifications:', 'harness2/core/recursion.py -> src/schedule.ts',
      'harness2/core/tree.py -> src/candidate.ts']
    if (!required.every(text => notice.includes(text))) failures.push(`${directory}/NOTICE: incomplete pinned source attribution or modification mapping.`)
  }
  if (!isStringArray(manifest.files) || !manifest.files.includes('NOTICE')) {
    failures.push(`${HARNESS2_PACKAGE}: published files must include NOTICE; npm also includes LICENSE.`)
  }
  return failures
}

/** Result of checking every DSH package reachable through the root workspace list. */
export interface DshPackageLicenseReport {
  /** Number of DSH package manifests checked. */
  packageCount: number
  /** Repository-relative diagnostics for license declarations and required notices. */
  failures: string[]
}

function readManifest(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-dsh-package-licenses: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function workspaceManifestPaths(root: string): string[] {
  const rootManifest = readManifest(root, 'package.json')
  const workspaces = rootManifest.workspaces
  if (!isStringArray(workspaces)) {
    throw new Error('verify-dsh-package-licenses: package.json workspaces must be a string array.')
  }

  const files = new Set(['package.json'])
  for (const pattern of workspaces) {
    for (const file of globSync(`${pattern}/package.json`, { cwd: root })) {
      files.add(file)
    }
  }
  return [...files].sort()
}

function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check every DSH npm package declared by the repository workspace.
 * @param root - absolute repository root containing the workspace package.json.
 * @returns the checked package count and every license-policy violation.
 */
export function inspectDshPackageLicenses(root: string): DshPackageLicenseReport {
  let packageCount = 0
  const failures: string[] = []

  for (const file of workspaceManifestPaths(root)) {
    const manifest = readManifest(root, file)
    const name = manifest.name
    if (typeof name !== 'string' || !DSH_PACKAGE_NAME.test(name)) continue

    packageCount++
    const normalizedFile = file.split(sep).join('/')
    if (normalizedFile === HARNESS2_PACKAGE && name === HARNESS2_NAME) {
      if (manifest.license !== HARNESS2_LICENSE) failures.push(
        `${normalizedFile}: ${name} must declare "license": "${HARNESS2_LICENSE}"; found ${printable(manifest.license)}.`,
      )
      failures.push(...inspectHarness2Notices(root, manifest))
    } else if (manifest.license !== 'MIT') {
      failures.push(
        `${normalizedFile}: ${name} must declare "license": "MIT"; found ${printable(manifest.license)}.`,
      )
    }
  }

  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectDshPackageLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-dsh-package-licenses: DSH package license-policy violations found:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-dsh-package-licenses: ${String(report.packageCount)} DSH package(s) checked; license declarations and required notices conform.\n`,
    )
  }
}
