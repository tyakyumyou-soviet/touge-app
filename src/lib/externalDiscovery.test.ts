import { describe, expect, it } from 'vitest'
import { buildRoadDiscoveryQuery, validateDiscoveredRoad } from './externalDiscovery'

describe('external road discovery', () => {
  it('uses a bounded Overpass around query and excludes private road classes', () => {
    const query = buildRoadDiscoveryQuery([139.03, 35.22], 100)
    expect(query).toContain('around:25000,35.220000,139.030000')
    expect(query).toContain('access')
    expect(query).toContain('out tags geom')
  })

  it('rejects geometries with a large discontinuity', () => {
    const result = validateDiscoveredRoad([[139, 35], [139.005, 35.005], [139.2, 35.2]])
    expect(result.warnings).toContain('道路形状に大きな欠落があります')
  })
})
