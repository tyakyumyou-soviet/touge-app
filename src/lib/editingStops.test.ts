import { describe, expect, it } from 'vitest'
import type { Course } from '../types'
import { editableStopsFromCourse } from './editingStops'

const course = {
  id: 'saved', name: '保存済みコース', area: '伊豆', prefecture: '静岡県', description: '',
  route: Array.from({ length: 100 }, (_, index) => [138.9 + index / 1000, 35 + index / 1000] as [number, number]),
  landmarks: [{ name: '展望台', progress: .25 }, { name: '峠', progress: .75 }], distanceKm: 12, durationMin: 20,
  minElevation: 1, maxElevation: 500, elevationProfile: [1, 500], ratings: { curves: 3, elevation: 3, width: 3, scenery: 3, surface: 3, traffic: 3, access: 3 }, ratingCount: 0,
  tags: [], cautions: [], visibility: 'public', authorId: 'owner', authorName: 'owner', updatedAt: '2026-09-02',
} satisfies Course

describe('editing stops', () => {
  it('does not expose dense road geometry as hundreds of editable stops', () => {
    expect(editableStopsFromCourse(course)).toEqual({
      route: [course.route[0], course.route[25], course.route[74], course.route[99]],
      labels: ['保存済みコース・始点', '展望台', '峠', '保存済みコース・終点'],
      roles: ['start', 'via', 'via', 'goal'],
    })
  })
})
