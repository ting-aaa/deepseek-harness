/** Fetch and verify the pinned portable Python distribution before packaging. @module */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { PYTHON_WASI_ASSET as asset } from '../packages/subagent/harness2/src/runtime-assets.ts'

/**
 * Materialize the runtime asset; existing verified bytes avoid network access.
 * @param destination - Absolute archive filename inside the owning package's build assets.
 * @param download - Fetch implementation used by the build host.
 * @returns Whether the archive needed downloading.
 */
export async function prepareHarness2Asset(destination: URL, download: typeof fetch = fetch): Promise<boolean> {
  const valid = (bytes: Uint8Array) => bytes.length === asset.bytes
    && createHash('sha256').update(bytes).digest('hex') === asset.sha256
  let current: Uint8Array | undefined
  try { current = await readFile(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (current !== undefined && valid(current)) return false
  const response = await download(asset.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Harness² Python runtime download failed: HTTP ${response.status}`)
  const chunks: Uint8Array[] = []
  let bytes = 0
  if (response.body === null) throw new Error('Harness² Python runtime download has no body')
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > asset.bytes) throw new Error('Harness² Python runtime download exceeds its pinned size')
    chunks.push(chunk)
  }
  const content = Buffer.concat(chunks)
  if (!valid(content)) throw new Error('Harness² Python runtime download failed SHA-256 verification')
  await mkdir(new URL('.', destination), { recursive: true })
  const temporary = new URL(`.${asset.name}.${randomUUID()}.tmp`, destination)
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return true
}

if (import.meta.main) {
  const destination = new URL(`../packages/subagent/harness2/assets/${asset.name}`, import.meta.url)
  await prepareHarness2Asset(destination)
  console.log(`Harness² portable Python runtime verified: ${asset.name}`)
}
