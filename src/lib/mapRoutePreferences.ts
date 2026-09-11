import type { UserProfile } from '../types'

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
