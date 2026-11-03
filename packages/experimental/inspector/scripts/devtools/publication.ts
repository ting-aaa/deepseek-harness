/** Publication of the complete DevTools frontend directory. */
import { rename } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'

/**
 * Rename the completed sibling directory into its absent destination.
 * Windows EACCES, EBUSY, and EPERM failures receive eight retries with 20–200 ms delays.
 * Exhausted retries and all other failures rethrow the original error.
 * The caller removes the destination before publication and cleans unpublished output on failure.
 * @param temporary - Completed frontend directory on the destination filesystem.
 * @param output - Absent destination for the complete frontend.
 * @param operations - Host platform, rename operation, and retry delay.
 * @returns Resolves after directory publication; rejects when the rename cannot complete.
 */
export async function publishDevtoolsDirectory(
  temporary: string,
  output: string,
  operations: {
    platform: NodeJS.Platform
    rename: (source: string, destination: string) => Promise<void>
    wait: (delayMs: number) => Promise<void>
  } = { platform: process.platform, rename, wait },
): Promise<void> {
  let delay = 20
  for (let retries = 0;; retries += 1) {
    try {
      await operations.rename(temporary, output)
      return
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (operations.platform !== 'win32' || retries >= 8 ||
          (code !== 'EACCES' && code !== 'EBUSY' && code !== 'EPERM')) throw error
    }
    await operations.wait(delay)
    delay = Math.min(delay * 2, 200)
  }
}
