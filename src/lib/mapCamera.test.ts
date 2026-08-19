import { describe, expect, it } from 'vitest'
import { bottomSheetInset, mergeCameraPadding, type RectLike } from './mapCamera'

const mapRect: RectLike = { top: 100, right: 360, bottom: 700, left: 0, width: 360, height: 600 }

describe('visible map camera viewport', () => {
  it('uses the transformed top of a live bottom sheet', () => {
    expect(bottomSheetInset(mapRect, [{ top: 460, right: 360, bottom: 700, left: 12, width: 348, height: 240 }])).toBe(240)
    expect(bottomSheetInset(mapRect, [{ top: 620, right: 360, bottom: 700, left: 12, width: 348, height: 80 }])).toBe(80)
  })

  it('ignores floating elements that do not reach the map bottom', () => {
    expect(bottomSheetInset(mapRect, [{ top: 180, right: 350, bottom: 300, left: 10, width: 340, height: 120 }])).toBe(0)
  })

  it('combines fitting margins with the covered area', () => {
    expect(mergeCameraPadding(mapRect, 240, { top: 30, right: 20, bottom: 30, left: 20 })).toEqual({
      top: 30, right: 20, bottom: 270, left: 20,
    })
  })

  it('keeps a usable map viewport even when a sheet is nearly full-screen', () => {
    const padding = mergeCameraPadding(mapRect, 590, { top: 30, bottom: 30 })
    expect(padding.top + padding.bottom).toBeCloseTo(504)
  })
})
