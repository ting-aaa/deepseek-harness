/** Whole-record historical evidence selection against the complete serialized child message. @module */
import { childPrompt } from './prompts.ts'

/**
 * Keep the newest complete experiences that fit alongside current execution evidence.
 * Oversized history is omitted as whole records with explicit counts; persistent records are unchanged.
 * @param task - Complete current task, included in every measured message.
 * @param mission - Complete phase assignment, including candidate proposal instructions.
 * @param evidence - Current-run evidence, which is never trimmed to make history fit.
 * @param library - Complete accepted experiences in chronological order.
 * @param reflection - Complete previous reflection; retained before individual history records when it fits.
 * @param maxChars - Deployment's complete child-message character limit.
 * @returns Evidence with bounded whole historical records and explicit omission counts.
 */
export function libraryEvidence<T>(
  task: string, mission: string, evidence: object, library: readonly T[], reflection: string, maxChars: number,
): { library: T[]; priorReflection: string; libraryOmitted: number; priorReflectionOmitted: boolean } {
  let selected: T[] = []
  let priorReflection = ''
  const result = (entries: T[], prior: string) => ({
    ...evidence, library: entries, priorReflection: prior,
    libraryOmitted: library.length - entries.length,
    priorReflectionOmitted: prior !== reflection,
  })
  const fits = (entries: T[], prior: string) => childPrompt(task, mission, result(entries, prior)).length <= maxChars
  if (!fits([], '')) throw new TypeError(`Harness² complete child message must be non-empty text with at most ${maxChars} characters; current evidence alone exceeds the budget`)
  if (fits([], reflection)) priorReflection = reflection
  for (const entry of library.toReversed()) {
    const next = [entry, ...selected]
    if (fits(next, priorReflection)) selected = next
  }
  return result(selected, priorReflection)
}
