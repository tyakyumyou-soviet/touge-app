import { describe, expect, it } from 'vitest'
import { insertDraftStops, type DraftStops } from './draftInsertion'
import type { Coordinate } from '../types'

const empty: DraftStops = { route: [], labels: [], roles: [] }
const points: Coordinate[] = [[139, 35], [139.01, 35.01], [139.02, 35.02]]
const labels = ['始点', '途中', '終点']

describe('pure draft insertion', () => {
  it('does not duplicate points when React evaluates an update twice', () => {
    const first = insertDraftStops(empty, points, labels, 'course')
    const repeated = insertDraftStops(empty, points, labels, 'course')
    expect(repeated).toEqual(first)
    expect(empty.route).toHaveLength(0)
    expect(first.route).toHaveLength(3)
    expect(first.labels).toHaveLength(3)
    expect(first.roles).toEqual(['start', 'via', 'goal'])
  })

  it('inserts a recommendation between existing start/via and goal without changing them', () => {
    const current = insertDraftStops(empty, points, labels, 'course')
    const addition: Coordinate[] = [[138, 34], [138.01, 34.01]]
    const next = insertDraftStops(current, addition, ['提案始点', '提案終点'], 'proposal')
    expect(next.route).toEqual([points[0], points[1], ...addition, points[2]])
    expect(next.roles).toEqual(['start', 'via', 'via', 'via', 'goal'])
    expect(next.labels).toEqual(['始点', '途中', '提案始点', '提案終点', '終点'])
    expect(current.route).toEqual(points)
  })

  it('respects an earlier insertion slot while retaining all later stops', () => {
    const current = insertDraftStops(empty, points, labels, 'course')
    const next = insertDraftStops(current, [[138, 34]], ['追加'], 'proposal', 0)
    expect(next.labels).toEqual(['始点', '追加', '途中', '終点'])
    expect(next.roles).toEqual(['start', 'via', 'via', 'goal'])
  })

  it('adds individual stops exactly once and promotes a replaced goal to a via', () => {
    const start = insertDraftStops(empty, [points[0]], ['始点'], 'via')
    const goal = insertDraftStops(start, [points[1]], ['旧ゴール'], 'goal')
    const next = insertDraftStops(goal, [points[2]], ['新ゴール'], 'goal')
    expect(next.route).toEqual(points)
    expect(next.roles).toEqual(['start', 'via', 'goal'])
  })

  it('allows adding ordinary vias after a recommended course without losing its goal', () => {
    const proposal = insertDraftStops(empty, points, labels, 'goal')
    const next = insertDraftStops(proposal, [[138, 34]], ['後から追加'], 'via')
    expect(next.labels).toEqual(['始点', '途中', '後から追加', '終点'])
    expect(next.roles).toEqual(['start', 'via', 'via', 'goal'])
  })

  it('does not automatically designate a proposal endpoint as goal', () => {
    expect(insertDraftStops(empty, points, labels, 'proposal').roles).toEqual(['start', 'via', 'via'])
    const start = insertDraftStops(empty, [[138, 34]], ['先に置いた始点'], 'via')
    expect(insertDraftStops(start, points, labels, 'proposal').roles).toEqual(['start', 'via', 'via', 'via'])
  })

  it('can explicitly use the proposal endpoint as goal without deleting the previous goal', () => {
    const current = insertDraftStops(empty, points, labels, 'course')
    const next = insertDraftStops(current, [[138, 34], [138.1, 34.1]], ['提案始点', '提案終点'], 'goal', 0)
    expect(next.labels).toEqual([...labels, '提案始点', '提案終点'])
    expect(next.roles).toEqual(['start', 'via', 'via', 'via', 'goal'])
  })
})
