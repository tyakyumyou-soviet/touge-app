import { describe, expect, it } from 'vitest'
import { driveProposalIdentity, generateDriveProposals, proposalCountFor, reverseDriveProposal } from './recommendations'
import type { Course } from '../types'

const base = (id: string, tollStatus: Course['tollStatus'], curves: number): Course => ({
  id, name: id, area: '伊豆', prefecture: '静岡県', description: '', route: [[139, 35], [139.02, 35.02]], distanceKm: 8, durationMin: 15, minElevation: 0, maxElevation: 300, elevationProfile: [0, 300],
  ratings: { curves, elevation: 4, width: 4, scenery: 4, surface: 4, traffic: 4, access: 4 }, ratingCount: 0, tags: [], cautions: [], tollStatus, visibility: 'public', authorId: 'a', authorName: 'a', updatedAt: '2026-08-20',
})

describe('drive proposals', () => {
  it('recognises the same suggested road in either direction', () => {
    const proposal = generateDriveProposals([base('same-road', 'free', 4)], { center: [139, 35], radiusKm: 10, maxDistanceKm: 20, toll: 'all', style: 'balanced', requiredPoints: [], proposalCount: 1 })[0]
    expect(driveProposalIdentity(reverseDriveProposal(proposal))).toBe(driveProposalIdentity(proposal))
  })

  it('filters toll roads and ranks the requested driving style', () => {
    const results = generateDriveProposals([base('wide', 'free', 3), base('curvy', 'free', 5), base('paid', 'toll', 5)], { center: [139, 35], radiusKm: 10, maxDistanceKm: 20, toll: 'free', style: 'winding', requiredPoints: [] })
    expect(results.map((item) => item.sourceCourseId)).toEqual(['curvy', 'wide'])
  })

  it('keeps the full road geometry while exposing a compact editable waypoint list', () => {
    const route = Array.from({ length: 80 }, (_, index) => [139 + index * .0001, 35 + Math.sin(index / 8) * .001] as [number, number])
    const course = { ...base('dense', 'free', 5), route }
    const [proposal] = generateDriveProposals([course], { center: [139, 35], radiusKm: 10, maxDistanceKm: 20, toll: 'free', style: 'winding', requiredPoints: [] })
    expect(proposal.route).toEqual(route)
    expect(proposal.waypoints?.length).toBeLessThan(route.length)
  })

  it('clamps detailed proposal counts to one through five', () => {
    expect(proposalCountFor({})).toBe(3)
    expect(proposalCountFor({ proposalCount: 0 })).toBe(1)
    expect(proposalCountFor({ proposalCount: 4 })).toBe(4)
    expect(proposalCountFor({ proposalCount: 9 })).toBe(5)
  })

  it('returns fewer proposals when the requested count cannot be satisfied', () => {
    const results = generateDriveProposals([base('only', 'free', 5)], { center: [139, 35], radiusKm: 10, maxDistanceKm: 20, proposalCount: 5, toll: 'free', style: 'winding', requiredPoints: [] })
    expect(results).toHaveLength(1)
  })

  it('reverses every directional field of a preview together', () => {
    const original = {
      id: 'proposal', source: 'openstreetmap' as const, name: 'テスト', area: '伊豆',
      route: [[139, 35], [139.01, 35.01], [139.02, 35.02]] as [number, number][],
      waypoints: [[139, 35], [139.02, 35.02]] as [number, number][],
      labels: ['始点', '経由地', '終点'], elevationProfile: [80, 160, 120],
      elevationSource: '地形傾向による推定' as const, tollStatus: 'free' as const,
      distanceKm: 4, score: 1, reasons: [],
    }
    const reversed = reverseDriveProposal(original)
    expect(reversed.route).toEqual([...original.route].reverse())
    expect(reversed.waypoints).toEqual([...original.waypoints].reverse())
    expect(reversed.labels).toEqual(['終点', '経由地', '始点'])
    expect(reversed.elevationProfile).toEqual([120, 160, 80])
  })
})
