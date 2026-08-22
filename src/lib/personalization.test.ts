import { describe, expect, it } from 'vitest'
import { normalizePersonalization, personalizedScore } from './personalization'
import { emptyRatings } from './course'

describe('personalization', () => {
  it('clamps answers to the five-point preference scale', () => expect(normalizePersonalization({ curves: 8, width: 0 })).toMatchObject({ curves: 5, width: 1 }))
  it('matches the selected road characteristics in both directions', () => {
    const wideCurvy = { ratings: { ...emptyRatings(3), width: 5, curves: 5 } }
    const narrowStraight = { ratings: { ...emptyRatings(3), width: 1, curves: 1 } }
    expect(personalizedScore(wideCurvy as never, { width: 5, curves: 5 })).toBeGreaterThan(personalizedScore(narrowStraight as never, { width: 5, curves: 5 }))
    expect(personalizedScore(narrowStraight as never, { width: 1, curves: 1 })).toBeGreaterThan(personalizedScore(wideCurvy as never, { width: 1, curves: 1 }))
  })
})
