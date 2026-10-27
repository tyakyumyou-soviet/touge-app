import type { UserProfile } from '../types'

export type ProfileChanges = Partial<Omit<UserProfile, 'id' | 'accountId' | 'followerCount'>>
type PendingField = { value: unknown; revision: number; failed: boolean }
export interface ProfileSettingsSnapshot { profile: UserProfile | null; ready: boolean; saving: boolean; error: string }

/** One optimistic profile shared by the map and settings. Each field keeps its
 * own edit revision so a snapshot or an older write cannot undo a newer edit. */
export class ProfileSettings {
  private base: UserProfile | null
  private pending = new Map<string, PendingField>()
  private listeners = new Set<() => void>()
  private revision = 0
  private snapshot: ProfileSettingsSnapshot

  constructor(initial: UserProfile | null, private write: (values: ProfileChanges, profile: UserProfile) => Promise<void>) {
    this.base = initial
    this.snapshot = { profile: initial, ready: Boolean(initial?.accountId), saving: false, error: '' }
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private pendingError() { return [...this.pending.values()].some((field) => field.failed) ? '変更をFirebaseに保存できませんでした。接続を確認してください。' : '' }

  private emit(error = this.snapshot.error) {
    const profile = this.base ? { ...this.base, ...Object.fromEntries([...this.pending].map(([key, field]) => [key, field.value])) } : null
    this.snapshot = { ...this.snapshot, profile, saving: [...this.pending.values()].some((field) => !field.failed), error }
    this.listeners.forEach((listener) => listener())
  }

  receive(profile: UserProfile | null) {
    // Firestore metadata/ACK events can contain identical arrays/maps with new
    // identities. Keep those identities stable so a text edit or save ACK does
    // not rebuild all map route GeoJSON and interrupt gestures.
    this.base = profile && this.base ? Object.fromEntries(Object.entries(profile).map(([key, value]) => {
      const previous = this.base![key as keyof UserProfile]
      return [key, typeof value === 'object' && value !== null && JSON.stringify(previous) === JSON.stringify(value) ? previous : value]
    })) as unknown as UserProfile : profile
    this.snapshot = { ...this.snapshot, ready: true }
    this.emit(this.pendingError())
  }

  readFailed() {
    this.snapshot = { ...this.snapshot, ready: true }
    this.emit('設定を同期できませんでした。接続状態を確認してください。')
  }

  change = (values: ProfileChanges): Promise<void> => {
    if (!this.base) return Promise.reject(new Error('プロフィールが読み込まれていません'))
    const revision = ++this.revision
    Object.entries(values).forEach(([key, value]) => this.pending.set(key, { value, revision, failed: false }))
    this.emit(this.pendingError())
    // Start the SDK write immediately. Firestore already preserves client
    // write order and queues offline writes; waiting for each server ACK adds
    // a network round trip to every subsequent interaction.
    return this.write(values, this.snapshot.profile!).then(() => {
      const confirmed = Object.fromEntries(Object.entries(values).filter(([key]) => this.pending.get(key)?.revision === revision))
      if (this.base) this.base = { ...this.base, ...confirmed }
      Object.keys(confirmed).forEach((key) => this.pending.delete(key))
      this.emit(this.pendingError())
    }, (error: unknown) => {
      let relevant = false
      Object.keys(values).forEach((key) => {
        const field = this.pending.get(key)
        if (field?.revision === revision) { field.failed = true; relevant = true }
      })
      if (relevant) this.emit(this.pendingError())
      throw error
    })
  }

  retry = () => {
    const failed = Object.fromEntries([...this.pending].filter(([, field]) => field.failed).map(([key, field]) => [key, field.value]))
    return Object.keys(failed).length ? this.change(failed) : Promise.resolve()
  }
}

const commonProfileKeys = ['displayName', 'photoURL', 'bio', 'homeArea', 'vehicleName', 'vehicleDetails', 'socialLinks', 'showcasePostUrls'] as const

/** Public map permissions do not belong in friendProfiles: its rules reject
 * those fields, which used to reject the entire settings batch as well. */
export function profileWriteData(values: ProfileChanges, profile: UserProfile, googlePhotoURL: string | null) {
  const common = Object.fromEntries(commonProfileKeys.flatMap((key) => key in values ? [[key, values[key]]] : []))
  if ('photoURL' in common) common.photoURL = values.photoURL || googlePhotoURL || null
  const mapChanged = 'mapVisibility' in values || 'mapAllowedViewerIds' in values
  const publicProfile = Object.keys(common).length || mapChanged ? {
    ...common,
    mapVisibility: profile.mapVisibility,
    mapAllowedViewerIds: profile.mapAllowedViewerIds ?? [],
  } : null
  return { user: values, publicProfile, friendProfile: Object.keys(common).length ? common : null }
}
