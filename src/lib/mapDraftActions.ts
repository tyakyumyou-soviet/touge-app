export type MapDraftAction = 'start' | 'via' | 'goal' | 'recommendation-center' | 'recommendation-via'

/**
 * Actions shown after tapping the map while composing a course.
 * The recommendation finder augments the ordinary course actions; it never
 * replaces them. This keeps map taps predictable when the finder accordion
 * is opened or closed.
 */
export function mapDraftActions(hasStart: boolean, recommendationOpen: boolean): MapDraftAction[] {
  const actions: MapDraftAction[] = hasStart ? ['via', 'goal'] : ['start']
  if (recommendationOpen) actions.push('recommendation-center', 'recommendation-via')
  return actions
}
