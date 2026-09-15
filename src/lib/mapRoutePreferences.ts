import type { Course, UserProfile } from '../types'

export type MapRouteSource = 'official' | 'mine' | 'friends'

export function mapRouteSourcesFromProfile(profile: UserProfile | null | undefined): MapRouteSource[] {
  if (profile?.mapRouteSources) return [...new Set(profile.mapRouteSources)]
  switch (profile?.mapRouteVisibility ?? 'all') {
    case 'friends': return ['mine', 'friends']
    case 'mine': return ['mine']
    case 'none': return []
    default: return ['official', 'mine', 'friends']
  }
}

export function visibleMapFriendIds(profile: UserProfile | null | undefined, acceptedFriendIds: string[]): Set<string> {
  if (profile?.mapRouteFriendScope !== 'lists') return new Set(acceptedFriendIds)
  const selected = new Set(profile.mapRouteFriendListIds ?? [])
  const members = (profile.friendLists ?? []).filter((list) => selected.has(list.id)).flatMap((list) => list.memberIds)
  return new Set(members.filter((id) => acceptedFriendIds.includes(id)))
}

export function mapRouteSourceForCourse(course: Pick<Course, 'isSeed' | 'authorId'>, userId: string | null | undefined): MapRouteSource | null {
  if (course.isSeed) return 'official'
  if (userId && course.authorId === userId) return 'mine'
  return course.authorId ? 'friends' : null
}

export function mapRouteOverride(profile: UserProfile | null | undefined, courseId: string): 'show' | 'hide' | undefined {
  return profile?.mapRouteOverrides?.[courseId] ?? (profile?.hiddenRouteIds?.includes(courseId) ? 'hide' : undefined)
}

export function isCourseVisibleByMapPreferences(course: Pick<Course, 'id' | 'isSeed' | 'authorId'>, profile: UserProfile | null | undefined, userId: string | null | undefined, acceptedFriendIds: string[]): boolean {
  const source = mapRouteSourceForCourse(course, userId)
  if (!source) return false
  if (source === 'friends' && !visibleMapFriendIds(profile, acceptedFriendIds).has(course.authorId)) return false
  const override = mapRouteOverride(profile, course.id)
  if (override) return override === 'show'
  return mapRouteSourcesFromProfile(profile).includes(source)
}
