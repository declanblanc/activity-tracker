import { describe, expect, it } from 'vitest'
import { assignLanes, laneSpans, type Span } from './lanes.ts'

describe('assignLanes', () => {
  it('keeps non-overlapping spans in one lane', () => {
    expect(
      assignLanes([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([0, 0])
  })

  it('keeps touching spans in one lane', () => {
    expect(
      assignLanes([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([0, 0])
  })

  it('splits overlapping spans into separate lanes', () => {
    expect(
      assignLanes([
        { start: 0, end: 30 },
        { start: 10, end: 40 },
        { start: 20, end: 50 },
      ]),
    ).toEqual([0, 1, 2])
  })

  it('reuses a lane once its span has ended', () => {
    expect(
      assignLanes([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
        { start: 30, end: 40 },
      ]),
    ).toEqual([0, 1, 1])
  })

  it('returns lanes in input order regardless of the order given', () => {
    expect(
      assignLanes([
        { start: 20, end: 50 },
        { start: 0, end: 30 },
      ]),
    ).toEqual([1, 0])
  })
})

describe('laneSpans', () => {
  /** The two always travel together: a width is only meaningful against its lane. */
  const widths = (spans: Span[]) => laneSpans(spans, assignLanes(spans))

  it('gives every span the full width when none overlap', () => {
    expect(
      widths([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([1, 1])
  })

  it('gives touching spans the full width', () => {
    // Same rule as the lane assignment: touching is not overlapping.
    expect(
      widths([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([1, 1])
  })

  it('does not narrow a lone span because something else overlapped elsewhere', () => {
    // The bug this exists for: a morning overlap used to halve the evening too.
    expect(
      widths([
        { start: 9, end: 12 },
        { start: 10, end: 13 },
        { start: 20, end: 21 },
      ]),
    ).toEqual([2, 2, 1])
  })

  it('shares one width across a transitive cluster', () => {
    // A and C never meet, but both overlap B, so all three share a denominator —
    // otherwise B would be drawn at two widths down its own length.
    expect(
      widths([
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 15, end: 25 },
      ]),
    ).toEqual([2, 2, 2])
  })

  it('counts the deepest pile in a cluster, not the pile at each instant', () => {
    expect(
      widths([
        { start: 0, end: 30 },
        { start: 1, end: 30 },
        { start: 2, end: 30 },
      ]),
    ).toEqual([3, 3, 3])
  })

  it('keeps separate clusters on separate denominators', () => {
    expect(
      widths([
        { start: 0, end: 10 },
        { start: 1, end: 11 },
        { start: 20, end: 30 },
        { start: 21, end: 31 },
        { start: 22, end: 32 },
      ]),
    ).toEqual([2, 2, 3, 3, 3])
  })

  it('handles an empty day', () => {
    expect(widths([])).toEqual([])
  })
})
