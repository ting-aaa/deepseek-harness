/** Deterministic bounding of current-run execution evidence and trajectories. @module */

/** Bounded head-and-tail record of one rollout's logged execution events. */
export interface ExecutionTrace {
  readonly limit: number
  readonly head: string[]
  headChars: number
  readonly tail: string[]
  tailChars: number
  omitted: number
}

/**
 * Create an empty trajectory record; the limit applies to the complete rendered text.
 * @param limit - Positive complete trajectory character budget.
 * @returns Mutable trace owned by one rollout and its nested delegates.
 */
export function createTrace(limit: number): ExecutionTrace {
  return { limit, head: [], headChars: 0, tail: [], tailChars: 0, omitted: 0 }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const marker = `…[${text.length - max} chars omitted]…`
  if (marker.length >= max) return marker.slice(0, max)
  const keep = Math.max(0, max - marker.length)
  return text.slice(0, Math.ceil(keep / 2)) + marker + text.slice(text.length - Math.floor(keep / 2))
}

/**
 * Record one event, keeping the earliest and the newest events within half the budget each.
 * Oversized single events are clipped in the middle; dropped middle events are counted.
 * @param trace - Rollout trace.
 * @param text - Serialized event.
 */
export function pushTrace(trace: ExecutionTrace, text: string): void {
  // Reserve room for the omission marker so the earliest events survive rendering.
  const half = Math.max(1, Math.floor((trace.limit - 48) / 2))
  const event = clip(text, Math.max(1, half - 1))
  if (trace.tail.length === 0 && trace.headChars + event.length + 1 <= half) {
    trace.head.push(event)
    trace.headChars += event.length + 1
    return
  }
  trace.tail.push(event)
  trace.tailChars += event.length + 1
  while (trace.tailChars > half && trace.tail.length > 1) {
    trace.tailChars -= String(trace.tail.shift()).length + 1
    trace.omitted += 1
  }
}

/**
 * Render the bounded trajectory with an explicit marker for omitted middle events.
 * @param trace - Rollout trace.
 * @returns Newline-separated events, never longer than the configured limit.
 */
export function renderTrace(trace: ExecutionTrace): string {
  const marker = trace.omitted > 0 ? [`[… ${trace.omitted} trajectory events omitted …]`] : []
  return clip([...trace.head, ...marker, ...trace.tail].join('\n'), trace.limit)
}

type Shrinkable = { owner: Record<string, unknown>; key: 'trajectory' | 'answer' | 'executionEvidence' }

function collect(value: unknown, key: Shrinkable['key'], found: Shrinkable[]): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, key, found)
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record[key] === 'string' && record[key] !== '') found.push({ owner: record, key })
  for (const [name, child] of Object.entries(record)) if (name !== 'candidate') collect(child, key, found)
}

// Evidence is JSON data, so a JSON round-trip is an exact, acyclic copy.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Shrink current-run evidence until a complete child message fits: trajectories first, then
 * answers, each by repeatedly clipping the longest remaining text. Candidate trees are never
 * altered. The input is not mutated.
 * @param evidence - Current-run evidence object.
 * @param measure - Complete serialized child-message length for candidate evidence.
 * @param maxChars - Deployment's complete child-message limit.
 * @returns Fitting evidence plus the number of clipped fields, or the original when it already fits.
 */
export function fitEvidence<T extends object>(
  evidence: T, measure: (value: T) => number, maxChars: number,
): { evidence: T; clipped: number } {
  if (measure(evidence) <= maxChars) return { evidence, clipped: 0 }
  const copy = clone(evidence)
  const touched = new Set<Record<string, unknown>>()
  for (const key of ['executionEvidence', 'trajectory', 'answer'] as const) {
    const fields: Shrinkable[] = []
    collect(copy, key, fields)
    for (;;) {
      const over = measure(copy) - maxChars
      if (over <= 0) return { evidence: copy, clipped: touched.size }
      const longest = fields.reduce<Shrinkable | undefined>((best, field) =>
        best === undefined || String(field.owner[field.key]).length > String(best.owner[best.key]).length ? field : best, undefined)
      const text = longest === undefined ? '' : String(longest.owner[longest.key])
      if (longest === undefined || text.length <= 64) break
      // JSON escaping can expand text, so remove at least the overflow and at least half.
      longest.owner[longest.key] = clip(text, Math.max(64, Math.min(Math.floor(text.length / 2), text.length - over)))
      touched.add(longest.owner)
    }
  }
  throw new TypeError(`Harness² complete child message must be non-empty text with at most ${maxChars} characters; evidence cannot be reduced further`)
}
