import { describe, expect, it } from 'vitest'
import { canUseUnlimitedWaypoints, exceedsWaypointLimit, WAYPOINT_LIMIT } from './access'

describe('waypoint access control', () => {
  it('keeps the public editor at 25 points', () => {
    expect(exceedsWaypointLimit(WAYPOINT_LIMIT, false)).toBe(false)
    expect(exceedsWaypointLimit(WAYPOINT_LIMIT + 1, false)).toBe(true)
  })

  it('allows only the verified administrator email to bypass the editor limit', () => {
    expect(canUseUnlimitedWaypoints({ email: 'taizu61zx@gmail.com', emailVerified: true })).toBe(true)
    expect(canUseUnlimitedWaypoints({ email: 'taizu61zx@gmail.com', emailVerified: false })).toBe(false)
    expect(canUseUnlimitedWaypoints({ email: 'someone@example.com', emailVerified: true })).toBe(false)
  })
})
