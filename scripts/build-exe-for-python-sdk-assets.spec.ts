import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/build-exe-for-python-sdk.ts')
const pkgRequire = createRequire(createRequire(import.meta.url).resolve('@yao-pkg/pkg/package.json'))
const pkgGlob = pkgRequire('tinyglobby') as {
  globSync(patterns: string[], options: { cwd: string; dot: boolean; ignore: string[] }): string[]
}
const temporaryDirectories: string[] = []

interface AssetConfiguration {
  assets: string[]
  ignore: string[]
}

let configuration: AssetConfiguration

beforeAll(() => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm', script, '--skip-build', '--dry-run', '--targets=node24-macos-arm64',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: 'C:\\tools\\pnpm.cjs' },
  })
  expect(result.status, result.stderr).toBe(0)
  const line = result.stdout.split('\n').find(value => value.includes('[dry-run] patch '))
  if (line === undefined) throw new Error('Executable dry-run did not emit its asset configuration')
  configuration = (JSON.parse(line.slice(line.indexOf(' with ') + 6)) as { pkg: AssetConfiguration }).pkg
})

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Python runtime executable assets', () => {
  it.each([
    'node_modules',
    'node_modules/@deepseek-ai/dsh/node_modules',
    'node_modules/outer/node_modules/inner/node_modules',
  ])('retains runtime resources installed under %s', (modules) => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-executable-assets-'))
    temporaryDirectories.push(directory)
    const required = [
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/index.html`,
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/assets/app.js`,
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/assets/app.css`,
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/assets/font.woff2`,
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/site.webmanifest`,
      `${modules}/@deepseek-ai/dsh-example/assets/icon.svg`,
      `${modules}/@deepseek-ai/dsh-sandbox-windows-acl/assets/diagnose-acl.ps1`,
    ]
    const excluded = [
      `${modules}/@deepseek-ai/dsh-web-frontend/dist/assets/app.js.map`,
      `${modules}/@deepseek-ai/dsh-example/src/private.ts`,
      `${modules}/@deepseek-ai/dsh-example/private.py`,
      `${modules}/unrelated/assets/private.ps1`,
    ]
    for (const file of [...required, ...excluded]) {
      const path = join(directory, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'fixture\n')
    }

    const packaged = pkgGlob.globSync(configuration.assets, {
      cwd: directory, dot: true, ignore: configuration.ignore,
    }).map(path => path.replaceAll('\\', '/'))
    expect(packaged.sort()).toEqual(required.sort())
  })
})
