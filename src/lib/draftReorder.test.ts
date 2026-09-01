import { describe, expect, it } from 'vitest'
import { blockDropBoundary, moveDraftBlock, reverseDraftBlock } from './draftReorder'
import type { DraftStops } from './draftInsertion'

const draft: DraftStops = { route: [[139, 35], [140, 35], [141, 35], [142, 35]], labels: ['A', 'B始点', 'B終点', 'C'], roles: ['start', 'via', 'via', 'goal'] }
describe('draft block reordering', () => {
  it('moves downward past the immediate next row instead of treating it as a no-op', () => {
    const result = moveDraftBlock(draft, 0, 1, blockDropBoundary(0, { start: 1, count: 2 }))
    expect(result.labels).toEqual(['B始点', 'B終点', 'A', 'C'])
    expect(result.route).toEqual([draft.route[1], draft.route[2], draft.route[0], draft.route[3]])
    expect(result.roles).toEqual(['start', 'via', 'via', 'goal'])
  })
  it('moves the whole course before the preceding point', () => {
    expect(moveDraftBlock(draft, 1, 2, blockDropBoundary(1, { start: 0, count: 1 })).labels).toEqual(['B始点', 'B終点', 'A', 'C'])
  })
  it('moves the whole course after the final point', () => {
    const result = moveDraftBlock(draft, 1, 2, 4)
    expect(result.labels).toEqual(['A', 'C', 'B始点', 'B終点'])
    expect(result.roles).toEqual(['start', 'via', 'via', 'goal'])
  })
  it('does not invent a goal when the user has not chosen one yet', () => {
    expect(moveDraftBlock({ ...draft, roles: ['start', 'via', 'via', 'via'] }, 0, 1, 4).roles).toEqual(['start', 'via', 'via', 'via'])
  })
  it('ignores invalid and unchanged moves without mutating the source', () => {
    expect(moveDraftBlock(draft, 1, 2, 2)).toBe(draft)
    expect(moveDraftBlock(draft, -1, 1, 2)).toBe(draft)
    expect(moveDraftBlock(draft, 1, 8, 2)).toBe(draft)
    expect(draft.labels).toEqual(['A', 'B始点', 'B終点', 'C'])
  })

  it('reverses an incorporated course and swaps its endpoint labels', () => {
    const result = reverseDraftBlock({ ...draft, labels: ['前', '峠道・始点', '峠道・終点', '後'] }, 1, 2)
    expect(result.labels).toEqual(['前', '峠道・始点', '峠道・終点', '後'])
    expect(result.route).toEqual([draft.route[0], draft.route[2], draft.route[1], draft.route[3]])
    expect(result.roles).toEqual(['start', 'via', 'via', 'goal'])
  })

  it('does not create a goal while reversing a draft without one', () => {
    expect(reverseDraftBlock({ ...draft, roles: ['start', 'via', 'via', 'via'] }, 1, 2).roles).toEqual(['start', 'via', 'via', 'via'])
  })
})
