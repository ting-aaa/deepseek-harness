/** SDK fixture readiness gate: a failed replay install cannot expose the native fallback handshake. */
import type { Context } from '@deepseek-ai/cordis'
import * as Replay from '@deepseek-ai/dsh-llm-replay'

/** Fixture-local Loader identity. */
export const name = 'sdk-snapshot-replay-ready'
/** The replay implementation registers its adapter on this service. */
export const inject = ['llm']

/**
 * Publish lifecycle-owned readiness only after the actual replay installation succeeds.
 * @param ctx - fixture context owning the replay registration and marker.
 * @param config - unchanged replay configuration, including environment-based fixture paths.
 */
export function apply(ctx: Context, config: Replay.Config = {}): void {
  if (config.providers === undefined || config.providers.length === 0) {
    throw new Error('SDK snapshot replay requires an explicit provider catalog')
  }
  Replay.apply(ctx, config)
  ctx.provide('sdkSnapshotReplayReady', true)
}
