import { describe, expect, it } from 'vitest'
import { assessTougeSuitability, buildRoadDiscoveryQuery, chainRoadWays, proposalWaypoints, routeCandidateTargets, routedStopsFor, splitRoadCorridor, surroundingRouteCandidateTargets, validateDiscoveredRoad } from './externalDiscovery'
import { distanceKm } from './course'

describe('external road discovery', () => {
  it('uses a bounded Overpass around query and excludes private road classes', () => {
    const query = buildRoadDiscoveryQuery([139.03, 35.22], 100)
    expect(query).toContain('around:12000,35.220000,139.030000')
    expect(query).not.toContain('residential')
    expect(query).toContain('["name"]')
    expect(query).toContain('access')
    expect(query).toContain('sidewalk')
    expect(query).toContain('lit')
    expect(query).toContain('out tags geom')
    expect(query).toContain('out tags geom 80;')
  })

  it('caps the external road payload to keep a single suggestion responsive', () => {
    expect(buildRoadDiscoveryQuery([139.03, 35.22], 25, 40)).toContain('out tags geom 40;')
  })

  it('uses multiple compact probe lengths for a short maximum-distance search', () => {
    const targets = routeCandidateTargets([139.03, 35.22], 25, 4, 8)
    expect(targets).toHaveLength(8)
    expect(Math.max(...targets.map((item) => item.targetDistanceKm))).toBeLessThanOrEqual(4)
    expect(new Set(targets.map((item) => item.targetDistanceKm.toFixed(2))).size).toBeGreaterThan(2)
  })

  it.each([2, 4, 6, 10, 40])('searches farther within the radius for a %ikm course without lengthening the course', (maxDistance) => {
    const center: [number, number] = [138.95, 35.04]
    const probes = surroundingRouteCandidateTargets(center, 25, maxDistance)
    expect(probes).toHaveLength(8)
    for (const probe of probes) {
      expect(distanceKm(center, probe.start)).toBeGreaterThan(8)
      expect(distanceKm(center, probe.start)).toBeLessThan(25)
      expect(distanceKm(center, probe.goal)).toBeLessThan(25)
      expect(probe.targetDistanceKm).toBeLessThanOrEqual(maxDistance)
      expect(distanceKm(probe.start, probe.goal)).toBeLessThanOrEqual(maxDistance)
    }
  })

  it('uses the selected place only as a search centre, never as an implicit via point', () => {
    const start: [number, number] = [139, 35]
    const searchCentre: [number, number] = [139.1, 35.1]
    const required: [number, number] = [139.02, 35.02]
    const goal: [number, number] = [139.04, 35.04]
    expect(routedStopsFor(start, [required], goal)).toEqual([start, required, goal])
    expect(routedStopsFor(start, [required], goal)).not.toContainEqual(searchCentre)
  })

  it('splits a long mountain road into uninterrupted short-course candidates', () => {
    const route = Array.from({ length: 25 }, (_, index) => [139 + index * .002, 35 + Math.sin(index / 2) * .001] as [number, number])
    const segments = splitRoadCorridor(route, 4)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((segment) => segment.length >= 3)).toBe(true)
    expect(segments.every((segment) => validateDiscoveredRoad(segment).roadLengthKm <= 4)).toBe(true)
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

  it('retains required stops in the editable route anchors', () => {
    const route = [[139, 35], [139.01, 35.01], [139.02, 35.02], [139.03, 35.03]] as [number, number][]
    const required = [route[2]]
    const waypoints = proposalWaypoints(route, required)
    expect(waypoints).toContainEqual(required[0])
  })

  it('joins named OSM way fragments into one mountain-road corridor', () => {
    const chains = chainRoadWays([
      { type: 'way', id: 10, tags: { name: '山道', highway: 'secondary' }, geometry: [{ lon: 139, lat: 35 }, { lon: 139.01, lat: 35.01 }] },
      { type: 'way', id: 11, tags: { name: '山道', highway: 'secondary' }, geometry: [{ lon: 139.01, lat: 35.01 }, { lon: 139.02, lat: 35.005 }] },
      { type: 'way', id: 12, tags: { name: '別の道', highway: 'secondary' }, geometry: [{ lon: 139.02, lat: 35.005 }, { lon: 139.03, lat: 35.01 }] },
    ])
    expect(chains).toHaveLength(2)
    expect(chains[0].wayIds).toEqual([10, 11])
    expect(chains[0].route).toHaveLength(3)
  })

  it('accepts a sufficiently long, winding mountain corridor with verified elevation', () => {
    const route = [
      [139, 35], [139.008, 35.008], [139.016, 35.004], [139.024, 35.012],
      [139.032, 35.008], [139.04, 35.016], [139.048, 35.012], [139.056, 35.02],
    ] as [number, number][]
    const result = assessTougeSuitability(route, [100, 150, 210, 270, 350, 300, 230, 160], { highway: 'secondary', ref: 'R1', maxspeed: '50' })
    expect(result.eligible).toBe(true)
    expect(result.elevationRangeM).toBe(250)
    expect(result.highPointM).toBe(350)
    expect(result.averageElevationM).toBeGreaterThan(220)
    expect(result.quietnessScore).toBeGreaterThan(4)
    expect(result.maxGradePct).toBeGreaterThan(3)
    expect(result.curveDensity).toBeGreaterThan(.18)
  })

  it('keeps compact mountain sections eligible for a 2km maximum-distance search', () => {
    const route = [[139, 35], [139.003, 35.004], [139.007, 35.001], [139.011, 35.006], [139.015, 35.003]] as [number, number][]
    const result = assessTougeSuitability(route, [150, 170, 205, 235, 190], { highway: 'secondary', ref: 'R-short', maxspeed: '40' }, {}, 2)
    expect(result.eligible).toBe(true)
    expect(result.elevationRangeM).toBe(85)
  })

  it('rejects junction-heavy slow routes even when their elevation looks mountainous', () => {
    const route = [
      [139, 35], [139.008, 35.008], [139.016, 35.004], [139.024, 35.012],
      [139.032, 35.008], [139.04, 35.016], [139.048, 35.012], [139.056, 35.02],
    ] as [number, number][]
    const result = assessTougeSuitability(route, [100, 150, 210, 270, 350, 300, 230, 160], {}, { averageSpeedKmh: 22, stepDensity: 1.6 })
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('生活道路・市街地らしさが強すぎます')
    expect(result.quietnessScore).toBeLessThan(3)
  })

  it('rejects flat, settled roads even when their geometry contains turns', () => {
    const route = [[139, 35], [139.01, 35.004], [139.02, 35], [139.03, 35.004], [139.04, 35]] as [number, number][]
    const result = assessTougeSuitability(route, [12, 13, 12, 13, 12], { highway: 'unclassified', lit: 'yes', sidewalk: 'both', maxspeed: '30' })
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('峠として十分な高低差がありません')
    expect(result.reasons).toContain('生活道路・市街地らしさが強すぎます')
  })

})
