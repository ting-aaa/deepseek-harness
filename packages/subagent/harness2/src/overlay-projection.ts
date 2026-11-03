/** Persist the overlay decision so resuming a Session keeps its original guidance. @module */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const decisionSchema = z.union([
  z.object({ disabled: z.literal(true) }).strict(),
  z.object({ workspace: z.string(), domain: z.string(), mode: z.enum(['parallel', 'sequential']),
    revision: z.number().int().positive(), candidateHash: z.string() }).strict(),
])
const stateSchema = decisionSchema.nullable()

/** Null means this Session has not recorded an overlay decision yet. */
export type OverlayState = z.infer<typeof stateSchema>

/** Replay only the decision; resource registration remains owned by Agent creation. */
export const overlayProjection: ProjectionDefinition<'harness2Overlay', OverlayState> = {
  key: 'harness2Overlay', stateVersion: 1, stateSchema,
  init: () => null,
  apply: (state, event) => event.type === 'harness2/overlay' ? event.data : state,
}
