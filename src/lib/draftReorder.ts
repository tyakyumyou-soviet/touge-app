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
