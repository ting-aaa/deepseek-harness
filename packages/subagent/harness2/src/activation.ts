/** Stop and drain a managed child when its owning operation ends or is cancelled. @module */
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'

/**
 * Await a published child, retaining ownership until disposal settles.
 * @param activation - Exact child activation owned by the caller.
 * @param signal - Operation lifetime, including plugin unload.
 * @returns The settled child result after its resources are released.
 */
export async function settleActivation(activation: SubagentActivation, signal: AbortSignal): Promise<SubagentResult> {
  let disposal: Promise<void> | undefined
  const dispose = () => (disposal ??= activation.dispose())
  const aborted = Promise.withResolvers<never>()
  const settled = Promise.race([activation.result, aborted.promise])
  const abort = () => {
    void dispose().then(() => { aborted.reject(signal.reason) }, (error: unknown) => { aborted.reject(error) })
  }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const result = await settled
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', abort)
    await dispose()
  }
}
