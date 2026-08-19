import { afterEach, describe, expect, it, vi } from 'vitest'
import { routeAlongRoads } from './routing'

describe('routeAlongRoads waypoint handling', () => {
  afterEach(() => vi.restoreAllMocks())

  it('splits long waypoint lists without imposing a user-facing limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      code: 'Ok',
      routes: [{ distance: 1000, duration: 60, geometry: { coordinates: [[139, 35], [139.1, 35.1]] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const waypoints = Array.from({ length: 26 }, (_, index) => [139 + index * .001, 35 + index * .001] as [number, number])

    const routed = await routeAlongRoads(waypoints)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(routed.route).toHaveLength(3)
    expect(routed.distanceKm).toBe(2)
    expect(routed.durationMin).toBe(2)
  })
})
