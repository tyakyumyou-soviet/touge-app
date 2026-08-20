import { describe, expect, it } from 'vitest'
import { generateDriveProposals } from './recommendations'
import type { Course } from '../types'

const base = (id: string, tollStatus: Course['tollStatus'], curves: number): Course => ({
  id, name: id, area: '伊豆', prefecture: '静岡県', description: '', route: [[139, 35], [139.02, 35.02]], distanceKm: 8, durationMin: 15, minElevation: 0, maxElevation: 300, elevationProfile: [0, 300],
  ratings: { curves, elevation: 4, width: 4, scenery: 4, surface: 4, traffic: 4, access: 4 }, ratingCount: 0, tags: [], cautions: [], tollStatus, visibility: 'public', authorId: 'a', authorName: 'a', updatedAt: '2026-08-20',
})

describe('drive proposals', () => {
  it('filters toll roads and ranks the requested driving style', () => {
    const results = generateDriveProposals([base('wide', 'free', 3), base('curvy', 'free', 5), base('paid', 'toll', 5)], { center: [139, 35], radiusKm: 10, maxDistanceKm: 20, toll: 'free', style: 'winding', requiredPoints: [] })
    expect(results.map((item) => item.sourceCourseId)).toEqual(['curvy', 'wide'])
  })
})
