import type { Course, TollStatus } from '../types'

export const tollStatusLabels: Record<TollStatus, string> = {
  free: '無料',
  toll: '有料',
  conditional: '条件付き無料',
  mixed: '有料・無料混在',
  unknown: '料金情報未確認',
}

export function courseTollStatus(course: Pick<Course, 'tollStatus' | 'tollInfo'>): TollStatus {
  return course.tollStatus ?? course.tollInfo?.type ?? 'unknown'
}

export function mergeTollStatuses(statuses: TollStatus[]): TollStatus {
  const unique = [...new Set(statuses.filter(Boolean))]
  if (!unique.length || unique.includes('unknown')) return unique.length === 1 ? 'unknown' : 'mixed'
  return unique.length === 1 ? unique[0] : 'mixed'
}
