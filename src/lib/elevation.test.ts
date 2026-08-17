import { describe, expect, it } from 'vitest'
import { isSuspiciousElevationProfile } from './elevation'

describe('elevation profile validation', () => {
  it('detects the old high-frequency artificial elevation pattern', () => {
    const broken = Array.from({ length: 120 }, (_, index) => 500 + Math.sin(index * 1.7) * 90)
    expect(isSuspiciousElevationProfile(broken)).toBe(true)
  })

  it('keeps a realistic mountain profile', () => {
    const realistic = Array.from({ length: 60 }, (_, index) => 220 + Math.sin((index / 59) * Math.PI) * 680)
    expect(isSuspiciousElevationProfile(realistic)).toBe(false)
  })
})
