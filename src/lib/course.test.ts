import { describe, expect, it } from 'vitest'
import { combinedRatings, googleMapsUrl, overallRating, routeDistanceKm } from './course'
import { sampleCourses } from '../data/courses'
import { routeAudits } from '../data/routes.generated'

describe('course helpers', () => {
  it('calculates a route length', () => {
    expect(routeDistanceKm([[139, 35], [139.1, 35]])).toBeGreaterThan(8)
  })

  it('weights the three driving axes', () => {
    expect(overallRating({ curves: 5, elevation: 5, width: 5, scenery: 1, surface: 1, traffic: 1, access: 1 })).toBe(3.6)
  })

  it('creates a Google Maps directions URL', () => {
    const url = googleMapsUrl(sampleCourses[0], false)
    expect(url).toContain('google.com/maps/dir')
    expect(url).toContain('origin=')
    expect(url).toContain('destination=')
    expect(new URL(url).searchParams.get('waypoints')?.split('|')).toHaveLength(8)
  })

  it('reverses only the Google Maps handoff direction', () => {
    const course = sampleCourses[0]
    const url = new URL(googleMapsUrl(course, false, true))
    expect(url.searchParams.get('origin')).toBe(`${course.route.at(-1)?.[1]},${course.route.at(-1)?.[0]}`)
    expect(url.searchParams.get('destination')).toBe(`${course.route[0][1]},${course.route[0][0]}`)
    expect(course.route[0]).not.toEqual(course.route.at(-1))
  })

  it('ships detailed road-following geometries', () => {
    expect(sampleCourses.every((course) => course.route.length > 100)).toBe(true)
    expect(sampleCourses[0].route.length).toBeGreaterThan(200)
  })

  it('ships only named-road geometries that passed the route audit', () => {
    const expectedRanges = {
      hakoneRoute: [11, 16],
      ashinokoRoute: [8, 12],
      izuRoute: [38, 44],
      okutamaRoute: [15, 17],
    } as const

    expect(routeAudits).toHaveLength(sampleCourses.length)
    for (const audit of routeAudits) {
      const [minimum, maximum] = expectedRanges[audit.key]
      expect(audit.distanceKm).toBeGreaterThanOrEqual(minimum)
      expect(audit.distanceKm).toBeLessThanOrEqual(maximum)
      expect(audit.wayIds.length).toBeGreaterThan(0)
    }
    expect(routeAudits.find(({ key }) => key === 'izuRoute')?.wayIds.length).toBeGreaterThanOrEqual(20)
  })

  it('keeps system scores separate from real user review counts', () => {
    expect(sampleCourses.every((course) => course.ratingCount === 0)).toBe(true)
    const course = { ...sampleCourses[0], userRatings: { curves: 2, elevation: 2, width: 2, scenery: 2, surface: 2, traffic: 2, access: 2 }, ratingCount: 1 }
    expect(overallRating(combinedRatings(course))).toBeLessThan(overallRating(course.systemRatings!))
  })
})
