/** Published children must drain even when cancellation precedes observation or teardown fails. */
import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { settleActivation } from '../src/activation.ts'

it('disposes an already cancelled activation exactly once before rejecting', async () => {
  const control = new AbortController()
  const reason = new Error('Cancelled before observation')
  control.abort(reason)
  const disposal = Promise.withResolvers<undefined>()
  const dispose = vi.fn(() => disposal.promise)
  const result = Promise.withResolvers<SubagentResult>()
  const operation = settleActivation({ childId: SessionId('already-cancelled'), result: result.promise, dispose }, control.signal)
  const failed = expect(operation).rejects.toBe(reason)
  expect(dispose).toHaveBeenCalledOnce()
  disposal.resolve(undefined)
  await failed
  expect(dispose).toHaveBeenCalledOnce()
})

it('reports failed disposal rather than accepting an unconfirmed child teardown', async () => {
  const control = new AbortController()
  const reason = new Error('Child teardown failed')
  const result = Promise.withResolvers<SubagentResult>()
  const dispose = vi.fn(async () => { throw reason })
  const operation = settleActivation({ childId: SessionId('failed-disposal'), result: result.promise, dispose }, control.signal)
  const failed = expect(operation).rejects.toBe(reason)
  control.abort(new Error('Cancel owned child'))
  await failed
  expect(dispose).toHaveBeenCalledOnce()
})
