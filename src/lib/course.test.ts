import { describe, expect, it } from 'vitest'
import { googleMapsUrl, overallRating, routeDistanceKm } from './course'
import { sampleCourses } from '../data/courses'

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

  it('ships detailed road-following geometries', () => {
    expect(sampleCourses.every((course) => course.route.length > 100)).toBe(true)
    expect(sampleCourses[0].route.length).toBeGreaterThan(200)
  })
})
