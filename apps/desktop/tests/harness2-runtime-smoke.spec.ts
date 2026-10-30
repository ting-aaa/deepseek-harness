/** The packaged Harness² gate must fail closed rather than resolve development sources or install missing packages. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { smokeHarness2Runtime } from '../scripts/smoke-harness2-runtime.ts'

it('rejects an incomplete installed dependency closure in a private target directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-harness2-payload-gate-'))
  onTestFinished(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  await expect(smokeHarness2Runtime(join(home, 'absent-installation'), process.execPath, {
    NODE_OPTIONS: '', NODE_PATH: '', DSH_HOME: home, HOME: home, USERPROFILE: home,
    APPDATA: home, LOCALAPPDATA: home,
  }, home)).rejects.toThrow('@deepseek-ai/dsh-base/package.json')
  await expect(readFile(join(home, 'package.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})
