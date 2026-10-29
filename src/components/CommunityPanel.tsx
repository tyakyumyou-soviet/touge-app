import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Course, CourseComment, FriendPresence, NowPlaying, ThemePreference, UserProfile } from '../types'
import { addCourseComment, deleteCourseComment, loadFriendProfile, loadUserProfile, subscribeCourseComments, subscribeCourseLikes, subscribeFriendPresence, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { useSwipeBack } from '../hooks/useSwipeBack'
import { FriendsPanel } from './FriendsPanel'
import { UserAvatar } from './UserAvatar'
import { FriendListsPanel } from './FriendListsPanel'
import { subscribeFriends } from '../lib/friends'
import { nowPlayingFromMediaSession, postEmbedUrl, postUrlsFromText } from '../lib/profile'
import { buildMusicRecognitionShortcutUrl, MUSIC_RECOGNITION_PENDING_KEY, MUSIC_RECOGNITION_SHORTCUT_NAME } from '../lib/iosMusicRecognition'
import { RouteDisplaySettings } from './RouteDisplaySettings'
import { PersonalizationSettings } from './PersonalizationSettings'
import { ThemeSettings } from './ThemeSettings'
import type { ResolvedTheme } from '../lib/theme'
import type { ProfileChanges } from '../lib/profileSettings'

interface Props { user: User | null; profile: UserProfile | null; saving: boolean; profileError: string; onProfileChange: (values: ProfileChanges) => Promise<void>; course?: Course | null; courses?: Course[]; musicDisplayEnabled?: boolean; themePreference: ThemePreference; resolvedTheme: ResolvedTheme; onThemeChange: (value: ThemePreference) => void; onClose: () => void; onLogout?: () => void; onAdminOpen?: () => void }

const socialNames = { x: 'X', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' } as const
type ShareAudience = 'friends' | 'lists'

function ShareAudienceSelector({ label, audience, listIds, lists, friendCount, onChange }: { label: string; audience: ShareAudience; listIds: string[]; lists: NonNullable<UserProfile['friendLists']>; friendCount: number; onChange: (audience: ShareAudience, listIds: string[]) => void }) {
  return <div className="presence-audience">
    <h4>{label}</h4>
    <label className="sharing-scope-select"><span>公開範囲</span><select value={audience} onChange={(event) => onChange(event.target.value as ShareAudience, listIds)}><option value="friends">フレンド全員（{friendCount}人）</option><option value="lists">フレンドリストから選ぶ</option></select></label>
    {audience === 'lists' && <div className="audience-list-options">{lists.length ? <>{lists.map((list) => <label key={list.id}><input type="checkbox" checked={listIds.includes(list.id)} onChange={(event) => onChange('lists', event.target.checked ? [...new Set([...listIds, list.id])] : listIds.filter((id) => id !== list.id))} /><span><strong>{list.name}</strong><small>{list.memberIds.length}人</small></span></label>)}<small>{listIds.length}件のリストを選択中</small></> : <p>フレンド画面でリストを作成すると選択できます。</p>}</div>}
  </div>
}

function ProfileShowcase({ profile, title }: { profile: UserProfile; title?: string }) {
  const socialEntries = Object.entries(profile.socialLinks ?? {}).filter(([, url]) => Boolean(url))
  const hasContent = profile.bio || profile.homeArea || profile.vehicleName || socialEntries.length > 0 || profile.showcasePostUrls?.length
  if (!hasContent) return null

  return <section className="profile-showcase" aria-label={title ?? 'プロフィールの公開プレビュー'}>
    {title && <div className="profile-showcase-heading">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : <span aria-hidden="true">{profile.displayName.slice(0, 1)}</span>}<h3>{title}</h3></div>}
    {profile.homeArea && <p className="friend-profile-area">📍 {profile.homeArea}</p>}
    {profile.bio && <p className="friend-profile-bio">{profile.bio}</p>}
    {profile.vehicleName && <div className="vehicle-card"><span>MY CAR</span><strong>{profile.vehicleName}</strong>{profile.vehicleDetails && <small>{profile.vehicleDetails}</small>}</div>}
    {socialEntries.length > 0 && <div className="social-link-row">{socialEntries.map(([network, url]) => <a key={network} href={url} target="_blank" rel="noreferrer">{socialNames[network as keyof typeof socialNames]}</a>)}</div>}
    {profile.showcasePostUrls?.map((url) => {
      const embed = postEmbedUrl(url)
      return <article className="showcase-post" key={url}>{embed ? <iframe src={embed} title="愛車SNS投稿" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" /> : <a href={url} target="_blank" rel="noreferrer">投稿を開く ↗</a>}</article>
    })}
  </section>
}

export function CommunityPanel({ user, profile, saving, profileError, onProfileChange, course, courses = [], musicDisplayEnabled = true, themePreference, resolvedTheme, onThemeChange, onClose, onLogout, onAdminOpen }: Props) {
  const sheet = useMobileSheet(true, 'account')
  const [profilePhotoDraft, setProfilePhotoDraft] = useState('')
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [likeState, setLikeState] = useState({ count: 0, liked: false })
  const [presence, setPresence] = useState<FriendPresence[]>([])
  const [activeMediaTrack, setActiveMediaTrack] = useState<NowPlaying | null>(null)
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({})
  const [selectedFriendProfile, setSelectedFriendProfile] = useState<UserProfile | null>(null)
  const [friendProfileLoading, setFriendProfileLoading] = useState(false)
  const [friendProfileError, setFriendProfileError] = useState('')
  const [settingsView, setSettingsView] = useState<'home' | 'profile' | 'friends' | 'friend-profile' | 'sharing' | 'settings'>('home')
  const contentRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])
  const [transitionDirection, setTransitionDirection] = useState('forward')
  // Reset the new view after React replaces its contents, before the browser
  // paints. Scrolling the outgoing view inside navigate makes it visibly jump.
  useLayoutEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [settingsView])
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [friendNames, setFriendNames] = useState<Record<string, string>>({})
  const profileSaveRevision = useRef(0)
  const locationIntentRevision = useRef(0)
  const musicSharingEnabled = musicDisplayEnabled && Boolean(profile?.musicSharingEnabled ?? profile?.nowPlaying)
  useEffect(() => {
    if (!musicSharingEnabled) { setActiveMediaTrack(null); return }
    const syncTrack = () => setActiveMediaTrack(nowPlayingFromMediaSession(navigator.mediaSession))
    syncTrack()
    const timer = window.setInterval(syncTrack, 1000)
    return () => window.clearInterval(timer)
  }, [musicSharingEnabled])
  useEffect(() => {
    if (!user) return
    return subscribeFriends(user.uid, (entries) => {
      const friends = entries.filter((entry) => entry.status === 'accepted')
      setFriendIds(friends.map((entry) => entry.sender === user.uid ? entry.recipient : entry.sender))
      setFriendNames(Object.assign({}, ...friends.map((entry) => entry.names)))
    }, () => { setFriendIds([]); setNotice('フレンドを同期できませんでした') })
  }, [user])
  function navigate(view: typeof settingsView) {
    setTransitionDirection(view === 'home' || (settingsView === 'friend-profile' && view === 'friends') ? 'back' : 'forward')
    setSettingsView(view)
  }
  const swipeBack = useSwipeBack(!course && settingsView !== 'home' ? () => navigate(settingsView === 'friend-profile' ? 'friends' : 'home') : undefined, '.community-view')
  async function openFriendProfile(id: string) {
    setSelectedFriendProfile(friendProfiles[id] ?? null)
    setFriendProfileError('')
    setFriendProfileLoading(true)
    navigate('friend-profile')
    try {
      const next = await loadFriendProfile(id)
      if (next) setSelectedFriendProfile(next)
      else setFriendProfileError('プロフィールをまだ確認できません。相手がアプリを更新すると表示されます。')
    } catch {
      setFriendProfileError('プロフィールを読み込めませんでした。接続状態とFirestoreルールをご確認ください。')
    } finally { setFriendProfileLoading(false) }
  }
  const profileImageUrl = profile?.photoURL || user?.photoURL
  const profileEditorImageUrl = profilePhotoDraft.trim() || user?.photoURL
  useEffect(() => { setProfilePhotoDraft(profile?.photoURL ?? '') }, [profile?.photoURL])
  useEffect(() => {
    if (!course?.authorId || course.authorId === user?.uid) { setAuthorProfile(null); return }
    loadUserProfile(course.authorId).then(setAuthorProfile).catch(() => setAuthorProfile(null))
  }, [course?.authorId, user?.uid])
  useEffect(() => {
    if (!course) { setComments([]); return }
    return subscribeCourseComments(course.id, setComments, () => setNotice('コメントを同期できませんでした'))
  }, [course])
  useEffect(() => {
    if (!course) { setLikeState({ count: 0, liked: false }); return }
    return subscribeCourseLikes(course.id, user?.uid, setLikeState)
  }, [course, user?.uid])
  useEffect(() => {
    if (!friendIds.length) { setPresence([]); return }
    return subscribeFriendPresence(friendIds, setPresence)
  }, [profile?.followingIds, friendIds])
  useEffect(() => {
    let active = true
    if (!friendIds.length) { setFriendProfiles({}); return () => { active = false } }
    Promise.all(friendIds.map((id) => loadFriendProfile(id).then((item) => [id, item] as const).catch(() => [id, null] as const))).then((items) => {
      if (active) setFriendProfiles(Object.fromEntries(items.filter((item): item is readonly [string, UserProfile] => Boolean(item[1]))))
    })
    return () => { active = false }
  }, [friendIds])
  function mapProfileViewerIds(nextProfile = profile) {
    if (nextProfile?.mapVisibility !== 'lists') return []
    const selected = new Set(nextProfile.mapProfileListIds ?? [])
    return [...new Set((nextProfile.friendLists ?? []).filter((list) => selected.has(list.id)).flatMap((list) => list.memberIds))].filter((id) => friendIds.includes(id))
  }
  function saveProfileChanges(values: ProfileChanges) {
    if (!user) return
    const revision = ++profileSaveRevision.current
    void onProfileChange(values)
      .then(() => { if (revision === profileSaveRevision.current) setNotice('変更を自動保存しました') })
      .catch(() => { if (revision === profileSaveRevision.current) setNotice('変更を保存できませんでした。接続状態を確認してください。') })
  }
  async function postComment() { if (!user || !course || !body.trim()) return; try { await addCourseComment(course.id, body.trim(), user); setBody('') } catch { setNotice('コメントを保存できませんでした') } }
  async function removeComment(commentId: string) { if (!course) return; try { await deleteCourseComment(course.id, commentId) } catch { setNotice('コメントを削除できませんでした') } }
  async function like() { if (!user || !course) return; await toggleCourseLike(course.id, user); setNotice('いいねを更新しました') }
  async function follow() {
    if (!user || !course?.authorId || course.authorId === user.uid) return
    const followed = await toggleFollow(course.authorId, user)
    const nextIds = followed ? [...new Set([...(profile?.followingIds ?? []), course.authorId])] : (profile?.followingIds ?? []).filter((id) => id !== course.authorId)
    patchProfile({ followingIds: nextIds }); setNotice(followed ? 'フォローしました' : 'フォローを解除しました')
  }
  async function saveFriendLists(friendLists: NonNullable<UserProfile['friendLists']>) {
    if (!user) return
    const validListIds = new Set(friendLists.map((list) => list.id))
    const locationSharing = profile?.locationSharing ? { ...profile.locationSharing, listIds: profile.locationSharing.listIds.filter((id) => validListIds.has(id)) } : undefined
    const musicSharingListIds = (profile?.musicSharingListIds ?? profile?.locationSharing?.listIds ?? []).filter((id) => validListIds.has(id))
    const mapProfileListIds = (profile?.mapProfileListIds ?? []).filter((id) => validListIds.has(id))
    const mapRouteFriendListIds = (profile?.mapRouteFriendListIds ?? []).filter((id) => validListIds.has(id))
    const base = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), friendLists, mapProfileListIds, mapRouteFriendListIds, musicSharingListIds, ...(locationSharing ? { locationSharing } : {}) }
    const next = { ...base, mapAllowedViewerIds: mapProfileViewerIds(base) }
    await onProfileChange({ friendLists, mapProfileListIds, mapRouteFriendListIds, musicSharingAudience: profile?.musicSharingAudience ?? profile?.locationSharing?.audience ?? 'friends', musicSharingListIds, mapAllowedViewerIds: next.mapAllowedViewerIds, ...(locationSharing ? { locationSharing } : {}) })
    setNotice('フレンドリストを保存しました')
  }
  function setLocationSharing(enabled: boolean) {
    if (!user) return
    const intentRevision = ++locationIntentRevision.current
    if (enabled && !navigator.geolocation) { setNotice('この端末では位置情報を利用できません'); return }
    const applyLocationSharing = (value: boolean) => {
      const latest = profileRef.current
      saveProfileChanges({ locationSharing: { ...(latest?.locationSharing ?? { audience: 'friends' as const, listIds: [] }), enabled: value }, musicSharingAudience: latest?.musicSharingAudience ?? latest?.locationSharing?.audience ?? 'friends', musicSharingListIds: latest?.musicSharingListIds ?? latest?.locationSharing?.listIds ?? [] })
    }
    applyLocationSharing(enabled)
    if (enabled) {
      // Request the permission from the user's switch interaction. Starting
      // watchPosition only in an effect can be blocked by some mobile browsers.
      navigator.geolocation.getCurrentPosition(
        () => { if (intentRevision === locationIntentRevision.current) setNotice('位置共有をオンにしました') },
        (error) => {
          if (intentRevision !== locationIntentRevision.current) return
          if (error.code === error.PERMISSION_DENIED) applyLocationSharing(false)
          const message = error.code === error.PERMISSION_DENIED ? '位置情報の許可が必要です。ブラウザーのサイト設定を確認してください' : error.code === error.POSITION_UNAVAILABLE ? '現在地を取得できませんでした。GPSや位置情報サービスを確認してください' : '現在地の取得がタイムアウトしました。通信・位置情報を確認して再試行してください'
          setNotice(message)
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
      )
      return
    }
    setNotice('位置共有をオフにしました')
  }
  function setMusicSharing(enabled: boolean) {
    if (!user) return
    const sessionTrack = enabled ? nowPlayingFromMediaSession(navigator.mediaSession) : null
    const preserveShortcutTrack = enabled && !sessionTrack && profile?.musicSharingSource === 'shortcut'
    const playing = enabled ? sessionTrack ?? (preserveShortcutTrack ? profile?.nowPlaying ?? null : null) : null
    const source = preserveShortcutTrack ? 'shortcut' as const : 'automatic' as const
    saveProfileChanges({ musicSharingEnabled: enabled, musicSharingSource: source, nowPlaying: playing })
    setNotice(enabled ? (playing ? '音楽共有をオンにし、再生中の曲を共有しました' : '音楽共有をオンにしました。再生情報を検出すると自動で共有します') : '音楽共有をオフにしました')
  }
  function recognizeCurrentSong() {
    const id = crypto.randomUUID()
    const request = { id, createdAt: Date.now() }
    localStorage.setItem(MUSIC_RECOGNITION_PENDING_KEY, JSON.stringify(request))
    window.location.assign(buildMusicRecognitionShortcutUrl(window.location.origin, id))
  }
  function patchProfile(values: ProfileChanges) {
    if (!user) return
    const merged = { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0, ...profile, ...values }
    const next = { ...merged, mapAllowedViewerIds: mapProfileViewerIds(merged) }
    const persistedValues = {
      ...values,
      // Persist the legacy-derived music audience when editing location scope,
      // so future location-scope changes cannot silently change music scope.
      ...('locationSharing' in values ? { musicSharingAudience: profile?.musicSharingAudience ?? profile?.locationSharing?.audience ?? 'friends', musicSharingListIds: profile?.musicSharingListIds ?? profile?.locationSharing?.listIds ?? [] } : {}),
      ...('mapVisibility' in values || 'mapProfileListIds' in values ? { mapAllowedViewerIds: next.mapAllowedViewerIds } : {}),
    }
    saveProfileChanges(persistedValues)
  }
  function saveProfilePhotoUrl() {
    const value = profilePhotoDraft.trim()
    if (!value) { patchProfile({ photoURL: null }); return }
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || value.length > 2048) throw new Error('invalid image URL')
    } catch {
      setNotice('画像URLはHTTPS形式で入力してください')
      setProfilePhotoDraft(profile?.photoURL ?? '')
      return
    }
    patchProfile({ photoURL: value })
  }
  const friendName = (id: string) => friendNames[id] || friendProfiles[id]?.displayName || id.slice(0, 8)
  const viewTitle = settingsView === 'profile' ? 'プロフィール' : settingsView === 'friends' ? 'フレンド' : settingsView === 'friend-profile' ? selectedFriendProfile?.displayName || 'プロフィール' : settingsView === 'sharing' ? '共有・プライバシー' : settingsView === 'settings' ? '設定' : 'アカウント'
  const recognizedTrack = activeMediaTrack ?? profile?.nowPlaying
  return <div className="modal-backdrop" role="presentation" {...sheet.backdropProps}><section className={`modal community-panel ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="community-title" {...swipeBack}>
    <div className="mobile-sheet-drag-region" {...sheet.dragProps} onClick={sheet.expandOnTap}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">{course ? 'コメント・いいね' : viewTitle}</h2></div><div className="community-header-actions">{!course && settingsView !== 'home' && <button type="button" className="icon-button" onClick={() => navigate(settingsView === 'friend-profile' ? 'friends' : 'home')} aria-label={settingsView === 'friend-profile' ? 'フレンド一覧へ戻る' : 'アカウントメニューへ戻る'}>←</button>}<button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></div></header></div>
    <div className="community-scroll" ref={contentRef} data-sheet-scroll {...sheet.scrollProps}><div key={course?.id ?? settingsView} className={`community-view ${transitionDirection}`}>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      {!course && <>
        {settingsView === 'home' && <section className="account-menu"><button type="button" className="account-summary account-summary-action" onClick={() => navigate('profile')} aria-label="プロフィールを表示・編集"><div className="profile-avatar" aria-hidden="true">{profileImageUrl ? <img src={profileImageUrl} alt="" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div><strong>{profile?.displayName || user.displayName || 'ドライバー'}</strong>{profile?.accountId && <span className="account-id-label">@{profile.accountId}</span>}<small>{profile?.vehicleName || '愛車を登録してプロフィールを整えよう'}</small></div><span className="account-summary-arrow" aria-hidden="true">→</span></button><div className="account-menu-grid"><button type="button" onClick={() => navigate('friends')}><strong>フレンド</strong><small>検索・申請・共有リスト</small><span>→</span></button><button type="button" onClick={() => navigate('sharing')}><strong>共有・プライバシー</strong><small>{musicDisplayEnabled ? '地図・現在地・音楽' : '地図・現在地'}</small><span>→</span></button><button type="button" onClick={() => navigate('settings')}><strong>設定</strong><small>表示・パーソナライズ</small><span>→</span></button></div>{onAdminOpen && <button type="button" className="button secondary admin-console-button" onClick={onAdminOpen}>管理コンソール</button>}{onLogout && <button type="button" className="text-button danger-button" onClick={onLogout}>ログアウト</button>}</section>}
        {settingsView === 'profile' && <><section className="profile-editor"><div className="profile-avatar" aria-label="プロフィール画像">{profileEditorImageUrl ? <img src={profileEditorImageUrl} alt="プロフィール画像プレビュー" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label className="wide">プロフィール画像URL<input type="url" value={profilePhotoDraft} onChange={(e) => setProfilePhotoDraft(e.target.value)} onBlur={saveProfilePhotoUrl} placeholder="https://example.com/profile.jpg" /><small>HTTPSの画像URLを入力してください。空欄にするとGoogleアカウントの画像に戻ります。</small></label><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label>愛車（任意）<input value={profile?.vehicleName ?? ''} onChange={(e) => patchProfile({ vehicleName: e.target.value })} placeholder="例: 86 GT MT" /></label><label>愛車メモ（任意）<input value={profile?.vehicleDetails ?? ''} onChange={(e) => patchProfile({ vehicleDetails: e.target.value })} placeholder="例: 年式・カラー・仕様" /></label></div></section><section className="profile-social"><h3>SNS・愛車紹介（任意）</h3><p>愛車の写真・動画を紹介するためのアカウントと投稿URLです。</p><div className="form-grid"><label>X<input value={profile?.socialLinks?.x ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, x: e.target.value } })} placeholder="https://x.com/username" /></label><label>Instagram<input value={profile?.socialLinks?.instagram ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/username" /></label><label>YouTube<input value={profile?.socialLinks?.youtube ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, youtube: e.target.value } })} placeholder="https://youtube.com/@channel" /></label><label>TikTok<input value={profile?.socialLinks?.tiktok ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, tiktok: e.target.value } })} placeholder="https://tiktok.com/@username" /></label><label className="wide">愛車紹介の投稿URL（任意）<textarea rows={3} value={(profile?.showcasePostUrls ?? []).join('\n')} onChange={(e) => patchProfile({ showcasePostUrls: postUrlsFromText(e.target.value) })} placeholder="愛車の写真・動画が載った投稿URLを1行ずつ（最大3件）" /><small>対応投稿は埋め込み表示、その他はリンクとして表示します。</small></label></div></section>{profile && <ProfileShowcase profile={profile} />}<p className="muted">プロフィールの変更は自動で保存されます。</p></>}
        {settingsView === 'friends' && <FriendsPanel uid={user.uid} name={profile?.displayName || user.displayName || 'ドライバー'} friendPhotoURL={(id) => friendProfiles[id]?.photoURL ?? null} onViewProfile={(id) => void openFriendProfile(id)} listCount={profile?.friendLists?.length ?? 0} listPanel={<FriendListsPanel lists={profile?.friendLists ?? []} friendIds={friendIds} friendName={friendName} friendPhotoURL={(id) => friendProfiles[id]?.photoURL ?? null} onSave={saveFriendLists} />} />}
        {settingsView === 'friend-profile' && <section className="friend-profile-view" aria-label="フレンドのプロフィール">{friendProfileLoading && !selectedFriendProfile && <p role="status">プロフィールを読み込み中…</p>}{friendProfileError && <p className={selectedFriendProfile ? 'muted' : 'form-error'} role="status">{friendProfileError}</p>}{selectedFriendProfile && <><header className="friend-profile-header"><UserAvatar className="friend-profile-avatar" name={selectedFriendProfile.displayName} photoURL={selectedFriendProfile.photoURL} /><div><h3>{selectedFriendProfile.displayName}</h3>{selectedFriendProfile.accountId && <span>@{selectedFriendProfile.accountId}</span>}</div></header><ProfileShowcase profile={selectedFriendProfile} />{!selectedFriendProfile.bio && !selectedFriendProfile.homeArea && !selectedFriendProfile.vehicleName && !selectedFriendProfile.showcasePostUrls?.length && !Object.values(selectedFriendProfile.socialLinks ?? {}).some(Boolean) && <div className="friend-profile-empty"><strong>プロフィール情報はまだありません</strong><p>自己紹介や愛車、SNSが登録されるとここに表示されます。</p></div>}</>}</section>}
        {settingsView === 'sharing' && <>
          <section className="presence-settings profile-map-audience" aria-labelledby="profile-map-audience-title">
            <h3 id="profile-map-audience-title">プロフィールを地図に表示</h3>
            <label className="sharing-scope-select"><span>表示する相手</span><select value={profile?.mapVisibility ?? 'friends'} onChange={(event) => patchProfile({ mapVisibility: event.target.value as UserProfile['mapVisibility'] })}><option value="friends">フレンド全員（{friendIds.length}人）</option><option value="lists">フレンドリストから選ぶ</option><option value="none">表示しない</option></select></label>
            {profile?.mapVisibility === 'lists' && <div className="audience-list-options">{(profile.friendLists ?? []).length ? <>{(profile.friendLists ?? []).map((list) => <label key={list.id}><input type="checkbox" checked={profile.mapProfileListIds?.includes(list.id)} onChange={(event) => patchProfile({ mapProfileListIds: event.target.checked ? [...new Set([...(profile.mapProfileListIds ?? []), list.id])] : (profile.mapProfileListIds ?? []).filter((id) => id !== list.id) })} /><span><strong>{list.name}</strong><small>{list.memberIds.length}人</small></span></label>)}<small>{profile.mapProfileListIds?.length ?? 0}件のリストを選択中</small></> : <p>フレンド画面でリストを作成すると選択できます。</p>}</div>}
          </section>
          <section className="presence-settings">
            <h3>{musicDisplayEnabled ? '位置情報と音楽の共有' : '位置情報の共有'}</h3>
            <div className="presence-sharing-options">
              <div className="presence-sharing-option">
                <label className="community-switch"><span><strong>位置情報を共有する</strong><small>現在地を共有相手の地図に表示します</small></span><input className="state-switch" type="checkbox" role="switch" aria-label="位置情報を共有する" checked={Boolean(profile?.locationSharing?.enabled)} onChange={(event) => setLocationSharing(event.target.checked)} /></label>
                {profile && <ShareAudienceSelector label="位置情報を共有する相手" audience={profile.locationSharing?.audience ?? 'friends'} listIds={profile.locationSharing?.listIds ?? []} lists={profile.friendLists ?? []} friendCount={friendIds.length} onChange={(audience, listIds) => patchProfile({ locationSharing: { enabled: Boolean(profile.locationSharing?.enabled), audience, listIds } })} />}
              </div>
              {musicDisplayEnabled && <div className="presence-sharing-option">
                <label className="community-switch"><span><strong>曲名を共有する</strong><small>再生中の曲名とアーティスト名だけを共有します</small></span><input className="state-switch" type="checkbox" role="switch" aria-label="曲名を共有する" checked={profile?.musicSharingEnabled ?? Boolean(profile?.nowPlaying)} onChange={(event) => setMusicSharing(event.target.checked)} /></label>
                {musicSharingEnabled && <div className="music-sharing-details">
                  {recognizedTrack?.title && <p className="automatic-sharing-status">再生中：{recognizedTrack.title}{recognizedTrack.artist ? ` / ${recognizedTrack.artist}` : ''}</p>}
                  <button type="button" className="button secondary music-recognition-button" onClick={recognizeCurrentSong}>iPhoneで今の曲を認識</button>
                  <details className="music-recognition-help"><summary>初回設定（iPhoneショートカット）</summary><ol><li>「ショートカット」アプリで新規ショートカットを作り、名前を <strong>{MUSIC_RECOGNITION_SHORTCUT_NAME}</strong> にします。</li><li>「ミュージックを認識」（Shazam）を追加します。</li><li>続けて「ミュージックの詳細を取得」で名前とアーティストを取り、「テキスト」に「名前」「改行」「アーティスト」の順で入れます。</li><li>保存後、この画面のボタンを押します。認識結果がこのアプリに戻り、共有設定がオンならフレンドに共有されます。</li></ol><p>曲が変わったときは再度ボタンを押してください。PWAが裏で常時監視する方式ではありません。</p></details>
                </div>}
                {profile && <ShareAudienceSelector label="曲名を共有する相手" audience={profile.musicSharingAudience ?? profile.locationSharing?.audience ?? 'friends'} listIds={profile.musicSharingListIds ?? profile.locationSharing?.listIds ?? []} lists={profile.friendLists ?? []} friendCount={friendIds.length} onChange={(audience, listIds) => patchProfile({ musicSharingAudience: audience, musicSharingListIds: listIds })} />}
              </div>}
            </div>
            <small>{musicDisplayEnabled ? '位置情報と曲名は、それぞれ公開範囲を個別に設定できます。' : '位置情報は個別に公開範囲を設定できます。'}</small>
            {presence.length > 0 && <div className="presence-list">{presence.map((item) => <span key={item.userId}>{item.displayName}{musicDisplayEnabled && item.nowPlaying?.title ? ` · ♪ ${item.nowPlaying.title}` : ''}{item.location ? ' · 位置共有中' : ''}</span>)}</div>}
          </section>
          <p className="muted">共有・プライバシーの変更は自動で保存されます。</p>
        </>}
        {settingsView === 'settings' && <>
          <ThemeSettings value={themePreference} resolvedTheme={resolvedTheme} onChange={(value) => { onThemeChange(value); patchProfile({ themePreference: value }) }} />
          {profile && <RouteDisplaySettings profile={profile} courses={courses} userId={user.uid} friendIds={friendIds} friendNames={friendNames} onChange={patchProfile} />}
          {profile && <PersonalizationSettings profile={profile} onChange={patchProfile} />}
        </>}
      </>}
      {course && <section className="social-thread">{authorProfile && <ProfileShowcase profile={authorProfile} title={`${course.authorName ?? authorProfile.displayName}のプロフィール`} />}<div className="social-actions"><button onClick={like}>{likeState.liked ? '♥ いいね済み' : '♡ いいね'} ({likeState.count})</button><button onClick={follow}>{profile?.followingIds?.includes(course.authorId) ? 'フォロー解除' : '＋ 作成者をフォロー'}</button></div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p>{item.authorId === user.uid && <button type="button" className="text-button danger-button" onClick={() => removeComment(item.id)}>削除</button>}</article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {(notice || saving || profileError) && <p className={`${profileError ? 'form-error' : saving ? 'form-saving' : 'form-success'}${!course && settingsView === 'home' ? ' account-menu-status' : ''}`} role="status">{profileError || (saving ? '変更を保存中…' : notice)}</p>}
    </div></div>
  </section></div>
}
