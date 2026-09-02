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
    const stops = editableStopsFromCourse(course)
    expect(stops.route).toHaveLength(12)
    expect(stops.route[0]).toEqual(course.route[0])
    expect(stops.route.at(-1)).toEqual(course.route.at(-1))
    expect(stops.labels).toEqual(expect.arrayContaining(['展望台', '峠']))
    expect(stops.labels).toEqual(expect.arrayContaining(['経路維持点 1']))
    expect(stops.roles[0]).toBe('start')
    expect(stops.roles.at(-1)).toBe('goal')
    expect(stops.route.every((coordinate) => course.route.some((point) => point[0] === coordinate[0] && point[1] === coordinate[1]))).toBe(true)
  })

  it('reconstructs editable anchors for a legacy course without landmarks', () => {
    const stops = editableStopsFromCourse({ ...course, landmarks: [] })
    expect(stops.route.length).toBeGreaterThan(2)
    expect(stops.route.length).toBeLessThanOrEqual(12)
    expect(stops.labels).toEqual(expect.arrayContaining(['経路維持点 1']))
  })

  it('restores every point the driver actually added when present', () => {
    const editorStops = [
      { coordinate: course.route[0], label: '自宅付近', role: 'start' as const },
      { coordinate: course.route[12], label: '必ず通る地点', role: 'via' as const },
      { coordinate: course.route[50], label: '組み込んだコース・始点', role: 'via' as const },
      { coordinate: course.route[99], label: '目的地', role: 'goal' as const },
    ]
    expect(editableStopsFromCourse({ ...course, editorStops })).toEqual({
      route: editorStops.map((stop) => stop.coordinate), labels: editorStops.map((stop) => stop.label), roles: editorStops.map((stop) => stop.role),
    })
  })
})
