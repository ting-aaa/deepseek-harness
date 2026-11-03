import { describe, expect, it } from 'vitest'
import { createTrace, fitEvidence, pushTrace, renderTrace } from '../src/evidence-fit.ts'

describe('execution trace', () => {
  it('keeps every event while the trajectory fits', () => {
    const trace = createTrace(100)
    pushTrace(trace, 'one')
    pushTrace(trace, 'two')
    expect(renderTrace(trace)).toBe('one\ntwo')
  })

  it('keeps the earliest and newest events and counts the omitted middle', () => {
    const trace = createTrace(120)
    for (const event of 'abcdefghijkl') pushTrace(trace, event.repeat(8))
    const text = renderTrace(trace)
    expect(text.startsWith('aaaaaaaa\nbbbbbbbb')).toBe(true)
    expect(text.endsWith('llllllll')).toBe(true)
    expect(text).toContain('trajectory events omitted')
    expect(trace.omitted).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(120)
  })

  it('clips a single oversized event and the rendered marker within the limit', () => {
    const trace = createTrace(60)
    pushTrace(trace, 'x'.repeat(500))
    pushTrace(trace, 'y'.repeat(500))
    pushTrace(trace, 'z'.repeat(500))
    const text = renderTrace(trace)
    expect(text).toContain('…[')
    expect(text.length).toBeLessThanOrEqual(60)
  })

  it('clips even when the limit is smaller than the omission marker', () => {
    const trace = createTrace(4)
    pushTrace(trace, 'abcdefghij')
    expect(renderTrace(trace).length).toBeGreaterThan(0)
    expect(renderTrace(trace).length).toBeLessThanOrEqual(4)
  })
})

describe('evidence fitting', () => {
  const measure = (value: object) => JSON.stringify(value).length

  it('returns fitting evidence unchanged', () => {
    const evidence = { history: [{ answer: 'short', trajectory: 'trace' }] }
    expect(fitEvidence(evidence, measure, 1000)).toEqual({ evidence, clipped: 0 })
  })

  it('clips trajectories before answers and never alters candidate trees', () => {
    const candidate = { 'systemprompt.md': 'k'.repeat(200) }
    const evidence = {
      baseline: [{ label: 'base1', answer: 'a'.repeat(300), trajectory: 't'.repeat(3000), candidate }],
      history: [{ label: 'inv1', answer: 'b'.repeat(300), trajectory: 'u'.repeat(2000), candidate }],
      current: candidate,
      empty: { trajectory: '' },
      nothing: null,
    }
    const { evidence: fitted, clipped } = fitEvidence(evidence, measure, 1800)
    expect(measure(fitted)).toBeLessThanOrEqual(1800)
    expect(clipped).toBeGreaterThan(0)
    expect(fitted.baseline[0]!.answer).toBe('a'.repeat(300))
    expect(fitted.baseline[0]!.candidate).toEqual(candidate)
    expect(fitted.current).toEqual(candidate)
    expect(evidence.baseline[0]!.trajectory).toHaveLength(3000)
  })

  it('clips execution evidence and then answers when trajectories are not enough', () => {
    const evidence = { output: { executionEvidence: 'e'.repeat(2000) }, finals: [{ answer: 'a'.repeat(4000) }, { answer: 'b'.repeat(100) }] }
    const { evidence: fitted } = fitEvidence(evidence, measure, 900)
    expect(measure(fitted)).toBeLessThanOrEqual(900)
    expect(fitted.finals[0]!.answer).toContain('chars omitted')
  })

  it('rejects evidence that cannot be reduced below the limit', () => {
    const evidence = { candidate: { 'systemprompt.md': 'k'.repeat(500) }, history: [{ answer: 'short' }] }
    expect(() => fitEvidence(evidence, measure, 100)).toThrow('evidence cannot be reduced further')
  })
})
