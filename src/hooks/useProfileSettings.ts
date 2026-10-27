import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../types'
import { ProfileSettings } from '../lib/profileSettings'
import { publishFriendProfile, saveUserProfileSettings, subscribeUserProfile } from '../lib/firebase'

function initialProfile(user: User | null, useCache = true): UserProfile | null {
  if (!user) return null
  try {
    const raw = useCache ? localStorage.getItem(`touge-profile-${user.uid}`) : null
    const cached = raw ? JSON.parse(raw) as UserProfile : null
    if (cached?.id === user.uid) return { ...cached, mapVisibility: cached.mapVisibility === 'lists' || cached.mapVisibility === 'none' ? cached.mapVisibility : 'friends' }
  } catch { /* Ignore an unavailable or invalid cache. */ }
  return { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0 }
}

export function useProfileSettings(user: User | null) {
  const settings = useMemo(() => new ProfileSettings(initialProfile(user), (values, profile) => {
    if (!user) return Promise.reject(new Error('ログインが必要です'))
    return saveUserProfileSettings(user, values, profile)
  }), [user])
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot)

  useEffect(() => {
    if (!user) { settings.receive(null); return }
    let published = false
    const unsubscribe = subscribeUserProfile(user.uid, (profile, fromCache) => {
      if (!profile && fromCache) return
      settings.receive(profile ?? initialProfile(user, false))
      const current = settings.getSnapshot().profile
      if (!published && !fromCache && current?.accountId) {
        published = true
        void publishFriendProfile(user, current).catch(() => undefined)
      }
    }, () => settings.readFailed())
    const retry = () => { void settings.retry().catch(() => undefined) }
    window.addEventListener('online', retry)
    window.addEventListener('pageshow', retry)
    return () => {
      unsubscribe()
      window.removeEventListener('online', retry)
      window.removeEventListener('pageshow', retry)
    }
  }, [settings, user])

  useEffect(() => {
    if (!user || !state.profile) return
    try { localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(state.profile)) } catch { /* Firestore's own persistent cache remains available. */ }
  }, [user, state.profile])

  return { ...state, change: settings.change, acceptAccountId: (accountId: string) => {
    const profile = settings.getSnapshot().profile
    if (profile) settings.receive({ ...profile, accountId })
  } }
}
