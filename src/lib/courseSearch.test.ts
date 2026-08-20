import { describe, expect, it } from 'vitest'
import { courseMatchesSearch, distanceToRouteKm } from './courseSearch'
import type { Course } from '../types'

const course = {
  id: 'test', name: '展望ワインディング', area: '伊豆・山道', prefecture: '静岡県', description: '海を望む峠道', route: [[138.9, 35], [139, 35]],
  distanceKm: 12, durationMin: 20, minElevation: 10, maxElevation: 400, elevationProfile: [10, 400], ratings: { curves: 5, elevation: 4, width: 3, scenery: 5, surface: 3, traffic: 3, access: 3 },
  ratingCount: 0, tags: ['展望', '無料'], cautions: [], tollStatus: 'free', visibility: 'public', authorId: 'a', authorName: '峠編集部', updatedAt: '2026-08-20',
} satisfies Course

describe('course search', () => {
  it('matches every whitespace-separated text term across tags and landmarks', () => {
    expect(courseMatchesSearch({ ...course, landmarks: [{ name: '海見台', progress: .5 }] }, { text: '展望 海見台' })).toBe(true)
    expect(courseMatchesSearch(course, { text: '展望 有料' })).toBe(false)
  })
  it('uses the route itself rather than a route centroid for radius search', () => {
    expect(distanceToRouteKm([138.9, 35], course.route)).toBeLessThan(.1)
    expect(courseMatchesSearch(course, { center: [138.9, 35], radiusKm: 1 })).toBe(true)
    expect(courseMatchesSearch(course, { toll: 'toll' })).toBe(false)
  })
})
