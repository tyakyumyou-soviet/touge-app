import { describe, expect, it } from 'vitest'
import { nextSheetSnap, raisedSheetHeight, type SheetSnap } from './sheetGeometry'

describe('bottom-anchored sheet expansion', () => {
  it('grows continuously by the upward drag distance', () => {
    expect([0, -20, -80, -140].map(y => raisedSheetHeight(430, y, 617))).toEqual([430, 450, 510, 570])
  })
  it('keeps the bottom fixed as the top follows the finger', () => {
    const bottom = 686
    expect(bottom - raisedSheetHeight(430, -80, 617)).toBe(176)
  })
  it('stops below the header and does not grow on a downward drag', () => {
    expect(raisedSheetHeight(430, -1000, 617)).toBe(617)
    expect(raisedSheetHeight(430, 40, 617)).toBe(430)
  })
  it('unfolds directly from the visible collapsed handle, not the hidden body height', () => {
    expect([0, -30, -150, -1000].map(y => raisedSheetHeight(54, y, 617))).toEqual([54, 84, 204, 617])
  })
  it.each([210, 300, 423, 430])('supports different content heights (%i px)', height => {
    expect(raisedSheetHeight(height, -80, 617)).toBe(height + 80)
  })
})

describe('three-step bottom sheet snapping', () => {
  it.each<[SheetSnap, number, SheetSnap]>([
    ['full', 180, 'middle'],
    ['middle', 180, 'minimized'],
    ['minimized', -180, 'middle'],
    ['middle', -180, 'full'],
    ['full', -180, 'full'],
    ['minimized', 180, 'minimized'],
    ['middle', 20, 'middle'],
  ])('moves %s with drag %i to %s', (current, drag, next) => {
    expect(nextSheetSnap(current, drag)).toBe(next)
  })
})
