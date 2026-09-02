import { describe, expect, it } from 'vitest'
import { buildCourseDraftDefaults, parseHashTags } from './courseDraft'

describe('course draft helpers', () => {
  it('derives a name, area and prefecture from named stops', () => {
    expect(buildCourseDraftDefaults(['静岡県熱海峠', '静岡県天城高原'])).toEqual({
      name: '熱海峠〜天城高原ドライブ',
      area: '熱海峠〜天城高原',
      prefecture: '静岡県',
    })
  })

  it('only accepts #prefixed tags separated by comma or whitespace', () => {
    expect(parseHashTags('#展望, #高原 #ワイド　通常語 #展望')).toEqual(['展望', '高原', 'ワイド'])
  })
})
