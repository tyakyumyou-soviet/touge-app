import type { Coordinate, DraftPointRole } from '../types'

export interface DraftStops {
  route: Coordinate[]
  labels: string[]
  roles: DraftPointRole[]
}

/** Pure update: safe to evaluate again without duplicating points or side effects. */
export function insertDraftStops(current: DraftStops, points: Coordinate[], labels: string[], mode: 'via' | 'goal' | 'course' | 'proposal', after: number | null = null): DraftStops {
  const goal = current.roles.indexOf('goal')
  const end = goal < 0 ? current.route.length : goal
  const at = mode === 'goal' ? current.route.length
    : after === null ? end : Math.min(end, Math.max(current.route.length ? 1 : 0, after + 1))
  const roles = mode === 'goal' ? current.roles.map((role) => role === 'goal' ? 'via' as const : role) : current.roles
  const insertedRoles: DraftPointRole[] = points.map((_, index) => {
    if (!current.route.length && index === 0) return 'start'
    if (index === points.length - 1 && (mode === 'goal' || (mode === 'proposal' && goal < 0) || (mode === 'course' && !current.route.length))) return 'goal'
    return 'via'
  })
  return {
    route: [...current.route.slice(0, at), ...points, ...current.route.slice(at)],
    labels: [...current.labels.slice(0, at), ...labels, ...current.labels.slice(at)],
    roles: [...roles.slice(0, at), ...insertedRoles, ...roles.slice(at)],
  }
}
