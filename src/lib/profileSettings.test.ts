import { describe, expect, it, vi } from 'vitest'
import type { UserProfile } from '../types'
import { ProfileSettings, profileWriteData, type ProfileChanges } from './profileSettings'

const profile: UserProfile = { id: 'driver', accountId: 'driver', displayName: 'ドライバー', bio: '', followingIds: [], followerCount: 0, mapVisibility: 'friends', mapRouteSources: ['official', 'mine', 'friends'], mapRouteOverrides: { hakone: 'hide' } }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('realtime settings shared by the map and account screen', () => {
  it('updates both consumers and starts the Firebase write before the server responds', async () => {
    const ack = deferred()
    const write = vi.fn(() => ack.promise)
    const settings = new ProfileSettings(profile, write)
    const map = vi.fn()
    const account = vi.fn()
    settings.subscribe(map)
    settings.subscribe(account)
    const saved = settings.change({ mapRouteSources: [] })
    expect(write).toHaveBeenCalledOnce()
    expect(settings.getSnapshot().profile?.mapRouteSources).toEqual([])
    expect(settings.getSnapshot().saving).toBe(true)
    expect(map).toHaveBeenCalledOnce()
    expect(account).toHaveBeenCalledOnce()
    ack.resolve()
    await saved
    expect(settings.getSnapshot().saving).toBe(false)
  })

  it('preserves local edits over an older initial snapshot while accepting unrelated remote settings', async () => {
    const ack = deferred()
    const settings = new ProfileSettings(profile, () => ack.promise)
    const saved = settings.change({ themePreference: 'dark' })
    settings.receive({ ...profile, themePreference: 'light', bio: '別端末で更新' })
    expect(settings.getSnapshot().profile).toMatchObject({ themePreference: 'dark', bio: '別端末で更新' })
    ack.resolve()
    await saved
    expect(settings.getSnapshot().profile?.themePreference).toBe('dark')
    settings.receive({ ...profile, themePreference: 'system' })
    expect(settings.getSnapshot().profile?.themePreference).toBe('system')
  })

  it('sends rapid changes without waiting for earlier acknowledgements, keeping the latest choice', async () => {
    const first = deferred(), last = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const settings = new ProfileSettings(profile, write)
    const before = settings.change({ mapRouteSources: [] })
    const after = settings.change({ mapRouteSources: ['mine'] })
    expect(write).toHaveBeenCalledTimes(2)
    last.resolve()
    await after
    first.resolve()
    await before
    expect(settings.getSnapshot().profile?.mapRouteSources).toEqual(['mine'])
    expect(settings.getSnapshot().saving).toBe(false)
  })

  it('does not retry an obsolete failed edit over a newer successful edit', async () => {
    const first = deferred(), last = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const settings = new ProfileSettings(profile, write)
    const before = settings.change({ themePreference: 'dark' }).catch(() => undefined)
    const after = settings.change({ themePreference: 'light' })
    last.resolve(); await after
    first.reject(new Error('permission-denied')); await before
    await settings.retry()
    expect(write).toHaveBeenCalledTimes(2)
    expect(settings.getSnapshot()).toMatchObject({ error: '', profile: { themePreference: 'light' } })
  })

  it('keeps a failed setting visible and retries only the latest failed fields on reconnect', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined)
    const settings = new ProfileSettings(profile, write)
    await expect(settings.change({ themePreference: 'dark' })).rejects.toThrow('unavailable')
    expect(settings.getSnapshot()).toMatchObject({ saving: false, profile: { themePreference: 'dark' } })
    expect(settings.getSnapshot().error).not.toBe('')
    await settings.change({ bio: '新しい自己紹介' })
    expect(settings.getSnapshot().error).not.toBe('')
    await settings.retry()
    expect(write.mock.calls[2][0]).toEqual({ themePreference: 'dark' })
    expect(settings.getSnapshot()).toMatchObject({ saving: false, error: '', profile: { themePreference: 'dark', bio: '新しい自己紹介' } })
  })

  it('keeps map preferences referentially stable across unrelated server updates', () => {
    const settings = new ProfileSettings(profile, async () => {})
    settings.receive({ ...profile, mapRouteSources: [...profile.mapRouteSources!], mapRouteOverrides: { ...profile.mapRouteOverrides }, bio: '更新' })
    expect(settings.getSnapshot().profile?.mapRouteSources).toBe(profile.mapRouteSources)
    expect(settings.getSnapshot().profile?.mapRouteOverrides).toBe(profile.mapRouteOverrides)
  })

  it('preserves an empty overrides map so removed exceptions really reset', async () => {
    const write = vi.fn<(values: ProfileChanges) => Promise<void>>(async () => {})
    const settings = new ProfileSettings(profile, write)
    await settings.change({ mapRouteOverrides: {} })
    expect(write.mock.calls[0][0]).toEqual({ mapRouteOverrides: {} })
    expect(settings.getSnapshot().profile?.mapRouteOverrides).toEqual({})
  })
})

describe('Firestore profile document boundaries', () => {
  it('never copies map audience permissions into friendProfiles', () => {
    const data = profileWriteData({ mapVisibility: 'none', mapAllowedViewerIds: [] }, { ...profile, mapVisibility: 'none' }, null)
    expect(data.friendProfile).toBeNull()
    expect(data.publicProfile).toEqual({ mapVisibility: 'none', mapAllowedViewerIds: [] })
  })

  it('includes a valid visibility for the first public-profile write and preserves Google photo fallback', () => {
    const data = profileWriteData({ displayName: '新しい名前', photoURL: null }, profile, 'https://example.com/google.jpg')
    expect(data.publicProfile).toMatchObject({ mapVisibility: 'friends', mapAllowedViewerIds: [], photoURL: 'https://example.com/google.jpg' })
    expect(data.friendProfile).toEqual({ displayName: '新しい名前', photoURL: 'https://example.com/google.jpg' })
    expect(data.user.photoURL).toBeNull()
  })

  it('keeps private settings out of both shared profiles', () => {
    const data = profileWriteData({ themePreference: 'dark', musicSharingEnabled: true, mapRouteOverrides: {} }, profile, null)
    expect(data.publicProfile).toBeNull()
    expect(data.friendProfile).toBeNull()
  })
})
