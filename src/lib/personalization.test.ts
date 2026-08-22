import { describe, expect, it } from 'vitest'
import { normalizePersonalization, personalizedScore } from './personalization'
import { emptyRatings } from './course'

describe('personalization', () => {
  it('clamps answers to the five-point preference scale', () => expect(normalizePersonalization({ curves: 8, width: 0 })).toMatchObject({ curves: 5, width: 1 }))
  it('prioritizes a course matching the answered preferences', () => {
    const wide = { ratings: { ...emptyRatings(3), width: 5, curves: 1 } }
    const winding = { ratings: { ...emptyRatings(3), width: 1, curves: 5 } }
    const preferences = { ...normalizePersonalization({}), width: 5, curves: 1 }
    expect(personalizedScore(wide as never, preferences)).toBeGreaterThan(personalizedScore(winding as never, preferences))
  })
})
