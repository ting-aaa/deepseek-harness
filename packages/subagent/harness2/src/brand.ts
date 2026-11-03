/** Opaque identities for persisted Harness² previews. @module */
import type { Harness2RunId as RunId } from './types.ts'

/** Identifies a completed preview without accepting arbitrary Session ids. */
export type Harness2RunId = RunId

/**
 * Brand an externally supplied preview identifier; existence and ownership are checked by remember.
 * @param id - preview identifier from a completed run.
 * @returns the same string carrying its preview identity type.
 */
export function Harness2RunId(id: string): RunId {
  return id as RunId
}
