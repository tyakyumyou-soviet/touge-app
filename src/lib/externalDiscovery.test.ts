import { describe, expect, it } from 'vitest'
import { buildRoadDiscoveryQuery, proposalWaypoints, validateDiscoveredRoad } from './externalDiscovery'

describe('external road discovery', () => {
  it('uses a bounded Overpass around query and excludes private road classes', () => {
    const query = buildRoadDiscoveryQuery([139.03, 35.22], 100)
    expect(query).toContain('around:12000,35.220000,139.030000')
    expect(query).not.toContain('residential')
    expect(query).toContain('access')
    expect(query).toContain('out tags geom')
    expect(query).toContain('out tags geom 80;')
  })

  it('caps the external road payload to keep a single suggestion responsive', () => {
    expect(buildRoadDiscoveryQuery([139.03, 35.22], 25, 40)).toContain('out tags geom 40;')
  })

  it('rejects geometries with a large discontinuity', () => {
    const result = validateDiscoveredRoad([[139, 35], [139.005, 35.005], [139.2, 35.2]])
    expect(result.warnings).toContain('道路形状に大きな欠落があります')
  })

  it('reduces editor stops without mutating the complete road geometry', () => {
    const route = Array.from({ length: 120 }, (_, index) => [139 + index * .0001, 35 + Math.sin(index / 7) * .001] as [number, number])
    const waypoints = proposalWaypoints(route)
    expect(waypoints.length).toBeLessThanOrEqual(6)
    expect(route).toHaveLength(120)
    expect(waypoints[0]).toEqual(route[0])
    expect(waypoints.at(-1)).toEqual(route.at(-1))
  })
})
