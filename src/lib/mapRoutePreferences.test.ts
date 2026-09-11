import { describe, expect, it } from 'vitest'
import type { UserProfile } from '../types'
import { mapRouteSourcesFromProfile, visibleMapFriendIds } from './mapRoutePreferences'

const profile = (values: Partial<UserProfile>): UserProfile => ({ id: 'me', displayName: 'Driver', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...values })

describe('map route display preferences', () => {
  it('preserves legacy visibility choices', () => {
    expect(mapRouteSourcesFromProfile(profile({ mapRouteVisibility: 'all' }))).toEqual(['official', 'mine', 'friends'])
    expect(mapRouteSourcesFromProfile(profile({ mapRouteVisibility: 'friends' }))).toEqual(['mine', 'friends'])
    expect(mapRouteSourcesFromProfile(profile({ mapRouteVisibility: 'mine' }))).toEqual(['mine'])
    expect(mapRouteSourcesFromProfile(profile({ mapRouteVisibility: 'none' }))).toEqual([])
  })

  it('combines multiple selected friend lists and excludes non-friends', () => {
    const value = profile({ mapRouteFriendScope: 'lists', mapRouteFriendListIds: ['touring', 'local'], friendLists: [
      { id: 'touring', name: 'Touring', memberIds: ['a', 'b'] },
      { id: 'local', name: 'Local', memberIds: ['b', 'c', 'outsider'] },
    ] })
    expect([...visibleMapFriendIds(value, ['a', 'b', 'c'])]).toEqual(['a', 'b', 'c'])
  })
})
