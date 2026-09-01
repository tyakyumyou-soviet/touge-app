import type { DraftStops } from './draftInsertion'

/** `to` is an insertion boundary in the original array, before removal. */
export function moveDraftBlock(current: DraftStops, from: number, count: number, to: number): DraftStops {
  if (![from, count, to].every(Number.isInteger) || count < 1 || from < 0 || from + count > current.route.length
    || to < 0 || to > current.route.length || (to >= from && to <= from + count)) return current
  const move = <T,>(items: T[]) => {
    const rest = [...items.slice(0, from), ...items.slice(from + count)]
    const at = to > from ? to - count : to
    return [...rest.slice(0, at), ...items.slice(from, from + count), ...rest.slice(at)]
  }
  const hadGoal = current.roles.includes('goal')
  return { route: move(current.route), labels: move(current.labels),
    roles: move(current.roles).map((_, index, items) => index === 0 ? 'start' : hadGoal && index === items.length - 1 ? 'goal' : 'via') }
}

export function blockDropBoundary(sourceStart: number, target: { start: number; count: number }) {
  return target.start > sourceStart ? target.start + target.count : target.start
}

/** Reverse one incorporated/proposed course while preserving the draft's global START/GOAL roles. */
export function reverseDraftBlock(current: DraftStops, start: number, count: number): DraftStops {
  if (!Number.isInteger(start) || !Number.isInteger(count) || count < 2 || start < 0 || start + count > current.route.length) return current
  const flipEndpointLabel = (label: string) => label.endsWith('・始点') ? `${label.slice(0, -2)}終点`
    : label.endsWith('・終点') ? `${label.slice(0, -2)}始点` : label
  const replace = <T,>(items: T[], block: T[]) => [...items.slice(0, start), ...block, ...items.slice(start + count)]
  const hadGoal = current.roles.includes('goal')
  const route = replace(current.route, [...current.route.slice(start, start + count)].reverse())
  const labels = replace(current.labels, [...current.labels.slice(start, start + count)].reverse().map(flipEndpointLabel))
  return { route, labels, roles: route.map((_, index) => index === 0 ? 'start' : hadGoal && index === route.length - 1 ? 'goal' : 'via') }
}
