import { describe, expect, it } from 'vitest'
import { mapDraftActions } from './mapDraftActions'

describe('map tap actions while composing a course', () => {
  it('offers a start only before the course has one', () => {
    expect(mapDraftActions(false, false)).toEqual(['start'])
    expect(mapDraftActions(true, false)).toEqual(['via', 'goal'])
  })

  it('keeps ordinary point actions and adds the recommendation via only while open', () => {
    expect(mapDraftActions(true, true)).toEqual(['via', 'goal', 'recommendation-via'])
    expect(mapDraftActions(true, false)).not.toContain('recommendation-via')
  })

  it('never shows another start after one already exists', () => {
    expect(mapDraftActions(true, true)).not.toContain('start')
  })
})
