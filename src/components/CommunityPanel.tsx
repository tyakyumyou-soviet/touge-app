import { useEffect, useRef, useState } from 'react'
import type { Course, CourseComment, FriendPresence, ThemePreference, UserProfile } from '../types'
import { addCourseComment, clearFriendPresence, deleteCourseComment, loadUserProfile, saveFriendPresence, saveUserProfileSettings, subscribeCourseComments, subscribeCourseLikes, subscribeFriendPresence, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { FriendsPanel } from './FriendsPanel'
import { FriendListsPanel } from './FriendListsPanel'
import { subscribeFriends } from '../lib/friends'
import { nowPlayingFromMediaMetadata, postEmbedUrl, postUrlsFromText } from '../lib/profile'
import { RouteDisplaySettings } from './RouteDisplaySettings'
import { PersonalizationSettings } from './PersonalizationSettings'
import { ThemeSettings } from './ThemeSettings'
import type { ResolvedTheme } from '../lib/theme'

interface Props { user: User | null; course?: Course | null; courses?: Course[]; themePreference: ThemePreference; resolvedTheme: ResolvedTheme; onThemeChange: (value: ThemePreference) => void; onClose: () => void; onLogout?: () => void; onAdminOpen?: () => void; onProfileSaved?: (profile: UserProfile) => void }

const socialNames = { x: 'X', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' } as const

function ProfileShowcase({ profile, title }: { profile: UserProfile; title?: string }) {
  const socialEntries = Object.entries(profile.socialLinks ?? {}).filter(([, url]) => Boolean(url))
  const hasContent = profile.vehicleName || socialEntries.length > 0 || profile.showcasePostUrls?.length
  if (!hasContent) return null

  return <section className="profile-showcase" aria-label={title ?? 'プロフィールの公開プレビュー'}>
    {title && <div className="profile-showcase-heading">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : <span aria-hidden="true">{profile.displayName.slice(0, 1)}</span>}<h3>{title}</h3></div>}
    {profile.vehicleName && <div className="vehicle-card"><span>MY CAR</span><strong>{profile.vehicleName}</strong>{profile.vehicleDetails && <small>{profile.vehicleDetails}</small>}</div>}
    {socialEntries.length > 0 && <div className="social-link-row">{socialEntries.map(([network, url]) => <a key={network} href={url} target="_blank" rel="noreferrer">{socialNames[network as keyof typeof socialNames]}</a>)}</div>}
    {profile.showcasePostUrls?.map((url) => {
      const embed = postEmbedUrl(url)
      return <article className="showcase-post" key={url}>{embed ? <iframe src={embed} title="愛車SNS投稿" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" /> : <a href={url} target="_blank" rel="noreferrer">投稿を開く ↗</a>}</article>
    })}
  </section>
}

export function CommunityPanel({ user, course, courses = [], themePreference, resolvedTheme, onThemeChange, onClose, onLogout, onAdminOpen, onProfileSaved }: Props) {
  const sheet = useMobileSheet()
  const { openResting } = sheet
  // Opening the account sheet can race with the activation event that
  // minimizes the discovery sheet. Always settle this newly mounted sheet at
  // its middle snap instead of inheriting the sibling's minimized state.
  useEffect(() => { openResting() }, [openResting])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [likeState, setLikeState] = useState({ count: 0, liked: false })
  const [presence, setPresence] = useState<FriendPresence[]>([])
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({})
  const [settingsView, setSettingsView] = useState<'home' | 'profile' | 'friends' | 'sharing' | 'settings'>('home')
  const contentRef = useRef<HTMLDivElement>(null)
  const [transitionDirection, setTransitionDirection] = useState('forward')
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [friendNames, setFriendNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!user) return
    return subscribeFriends(user.uid, (entries) => {
      const friends = entries.filter((entry) => entry.status === 'accepted')
      setFriendIds(friends.map((entry) => entry.sender === user.uid ? entry.recipient : entry.sender))
      setFriendNames(Object.assign({}, ...friends.map((entry) => entry.names)))
    }, () => { setFriendIds([]); setNotice('フレンドを同期できませんでした') })
  }, [user])
  function navigate(view: typeof settingsView) {
    setTransitionDirection(view === 'home' ? 'back' : 'forward')
    setSettingsView(view)
    contentRef.current?.scrollTo({ top: 0 })
  }
  const profileImageUrl = profile?.photoURL ?? user?.photoURL
  useEffect(() => {
    if (!user) return
    let active = true
    const fallback: UserProfile = { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0 }
    loadUserProfile(user.uid).then((value) => { if (active) setProfile(value ?? fallback) }).catch(() => { if (active) setNotice('プロフィールを読み込めませんでした。接続状態を確認してください') })
    return () => { active = false }
  }, [user])
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
    if (!profile?.followingIds?.length) { setFriendProfiles({}); return }
    Promise.all(profile.followingIds.map((id) => loadUserProfile(id).then((item) => [id, item] as const).catch(() => [id, null] as const))).then((items) => setFriendProfiles(Object.fromEntries(items.filter((item): item is readonly [string, UserProfile] => Boolean(item[1])))))
  }, [profile?.followingIds])
  function mapProfileViewerIds(nextProfile = profile) {
    if (nextProfile?.mapVisibility !== 'lists') return []
    const selected = new Set(nextProfile.mapProfileListIds ?? [])
    return [...new Set((nextProfile.friendLists ?? []).filter((list) => selected.has(list.id)).flatMap((list) => list.memberIds))].filter((id) => friendIds.includes(id))
  }
  function saveProfile() {
    if (!user || !profile) return
    const next = { ...profile, mapAllowedViewerIds: mapProfileViewerIds(profile) }
    setProfile(next); setSaving(true); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    void saveUserProfileSettings(user, next).then(() => setNotice('プロフィールを保存しました')).catch(() => setNotice('端末には保存しました。接続後に保存操作をもう一度行ってください。')).finally(() => setSaving(false))
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
    const mapProfileListIds = (profile?.mapProfileListIds ?? []).filter((id) => validListIds.has(id))
    const mapRouteFriendListIds = (profile?.mapRouteFriendListIds ?? []).filter((id) => validListIds.has(id))
    const base = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), friendLists, mapProfileListIds, mapRouteFriendListIds, ...(locationSharing ? { locationSharing } : {}) }
    const next = { ...base, mapAllowedViewerIds: mapProfileViewerIds(base) }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    await saveUserProfileSettings(user, { friendLists, mapProfileListIds, mapRouteFriendListIds, mapAllowedViewerIds: next.mapAllowedViewerIds, ...(locationSharing ? { locationSharing } : {}) })
    setNotice('フレンドリストを保存しました')
  }
  function viewerIds(nextProfile = profile) {
    const selected = new Set(nextProfile?.locationSharing?.listIds ?? [])
    const ids = nextProfile?.locationSharing?.audience === 'lists'
      ? (nextProfile.friendLists ?? []).filter((list) => selected.has(list.id)).flatMap((list) => list.memberIds)
      : friendIds
    return [...new Set(ids)].filter((id) => friendIds.includes(id))
  }
  function setLocationSharing(enabled: boolean) {
    if (!user) return
    if (enabled && !navigator.geolocation) { setNotice('この端末では位置情報を利用できません'); return }
    const next = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), locationSharing: { ...(profile?.locationSharing ?? { audience: 'friends' as const, listIds: [] }), enabled } }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    void saveUserProfileSettings(user, { locationSharing: next.locationSharing })
    const musicSharingEnabled = next.musicSharingEnabled ?? Boolean(next.nowPlaying)
    if (!enabled) {
      if (musicSharingEnabled && next.nowPlaying) void saveFriendPresence(user, { allowedViewerIds: viewerIds(next), nowPlaying: next.nowPlaying, location: null })
      else void clearFriendPresence(user.uid)
    }
    setNotice(enabled ? '位置共有をオンにしました。端末の許可後に更新を開始します' : '位置共有をオフにしました')
  }
  function setMusicSharing(enabled: boolean) {
    if (!user) return
    const playing = enabled ? nowPlayingFromMediaMetadata(navigator.mediaSession?.metadata) : null
    const next = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), musicSharingEnabled: enabled, nowPlaying: playing }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    void saveUserProfileSettings(user, { musicSharingEnabled: enabled, nowPlaying: playing })
    if (next.locationSharing?.enabled || playing) void saveFriendPresence(user, { allowedViewerIds: viewerIds(next), nowPlaying: playing, ...(next.locationSharing?.enabled ? {} : { location: null }) })
    else void clearFriendPresence(user.uid)
    setNotice(enabled ? (playing ? '音楽共有をオンにし、再生中の曲を共有しました' : '音楽共有をオンにしました。再生情報を検出すると自動で共有します') : '音楽共有をオフにしました')
  }
  function patchProfile(values: Partial<UserProfile>) { if (!user) return; setProfile((p) => ({ id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...p, ...values })) }
  const friendName = (id: string) => friendNames[id] || friendProfiles[id]?.displayName || id.slice(0, 8)
  const viewTitle = settingsView === 'profile' ? 'プロフィール' : settingsView === 'friends' ? 'フレンド' : settingsView === 'sharing' ? '共有・プライバシー' : settingsView === 'settings' ? '設定' : 'アカウント'
  return <div className="modal-backdrop" role="presentation" {...sheet.backdropProps}><section className={`modal community-panel ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="community-title">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps} onClick={sheet.expandOnTap}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">{course ? 'コメント・いいね' : viewTitle}</h2></div><div className="community-header-actions">{!course && settingsView !== 'home' && <button type="button" className="icon-button" onClick={() => navigate('home')} aria-label="アカウントメニューへ戻る">←</button>}<button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></div></header></div>
    <div className="community-scroll" ref={contentRef} data-sheet-scroll {...sheet.scrollProps}><div key={course?.id ?? settingsView} className={`community-view ${transitionDirection}`}>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      {!course && <>
        {settingsView === 'home' && <section className="account-menu"><div className="account-summary"><div className="profile-avatar" aria-label="プロフィール画像">{profileImageUrl ? <img src={profileImageUrl} alt="Googleアカウントのプロフィール画像" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div><strong>{profile?.displayName || user.displayName || 'ドライバー'}</strong>{profile?.accountId && <span className="account-id-label">@{profile.accountId}</span>}<small>{profile?.vehicleName || '愛車を登録してプロフィールを整えよう'}</small></div></div><div className="account-menu-grid"><button type="button" onClick={() => navigate('profile')}><strong>プロフィール</strong><small>自己紹介・愛車・SNS</small><span>→</span></button><button type="button" onClick={() => navigate('friends')}><strong>フレンド</strong><small>検索・申請・共有リスト</small><span>→</span></button><button type="button" onClick={() => navigate('sharing')}><strong>共有・プライバシー</strong><small>地図・現在地・音楽</small><span>→</span></button><button type="button" onClick={() => navigate('settings')}><strong>設定</strong><small>表示・パーソナライズ</small><span>→</span></button></div>{onAdminOpen && <button type="button" className="button secondary admin-console-button" onClick={onAdminOpen}>管理コンソール</button>}{onLogout && <button type="button" className="text-button danger-button" onClick={onLogout}>ログアウト</button>}</section>}
        {settingsView === 'profile' && <><section className="profile-editor"><div className="profile-avatar" aria-label="プロフィール画像">{profileImageUrl ? <img src={profileImageUrl} alt="Googleアカウントのプロフィール画像" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label>愛車（任意）<input value={profile?.vehicleName ?? ''} onChange={(e) => patchProfile({ vehicleName: e.target.value })} placeholder="例: 86 GT MT" /></label><label>愛車メモ（任意）<input value={profile?.vehicleDetails ?? ''} onChange={(e) => patchProfile({ vehicleDetails: e.target.value })} placeholder="例: 年式・カラー・仕様" /></label></div></section><section className="profile-social"><h3>SNS・愛車紹介（任意）</h3><p>愛車の写真・動画を紹介するためのアカウントと投稿URLです。</p><div className="form-grid"><label>X<input value={profile?.socialLinks?.x ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, x: e.target.value } })} placeholder="https://x.com/username" /></label><label>Instagram<input value={profile?.socialLinks?.instagram ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/username" /></label><label>YouTube<input value={profile?.socialLinks?.youtube ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, youtube: e.target.value } })} placeholder="https://youtube.com/@channel" /></label><label>TikTok<input value={profile?.socialLinks?.tiktok ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, tiktok: e.target.value } })} placeholder="https://tiktok.com/@username" /></label><label className="wide">愛車紹介の投稿URL（任意）<textarea rows={3} value={(profile?.showcasePostUrls ?? []).join('\n')} onChange={(e) => patchProfile({ showcasePostUrls: postUrlsFromText(e.target.value) })} placeholder="愛車の写真・動画が載った投稿URLを1行ずつ（最大3件）" /><small>対応投稿は埋め込み表示、その他はリンクとして表示します。</small></label></div></section>{profile && <ProfileShowcase profile={profile} />}<button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button></>}
        {settingsView === 'friends' && <FriendsPanel uid={user.uid} name={profile?.displayName || user.displayName || 'ドライバー'} listCount={profile?.friendLists?.length ?? 0} listPanel={<FriendListsPanel lists={profile?.friendLists ?? []} friendIds={friendIds} friendName={friendName} onSave={saveFriendLists} />} />}
        {settingsView === 'sharing' && <>
          <section className="presence-settings profile-map-audience" aria-labelledby="profile-map-audience-title">
            <h3 id="profile-map-audience-title">プロフィールを地図に表示</h3>
            <label className="sharing-scope-select"><span>表示する相手</span><select value={profile?.mapVisibility ?? 'friends'} onChange={(event) => patchProfile({ mapVisibility: event.target.value as UserProfile['mapVisibility'] })}><option value="friends">フレンド全員（{friendIds.length}人）</option><option value="lists">フレンドリストから選ぶ</option><option value="none">表示しない</option></select></label>
            {profile?.mapVisibility === 'lists' && <div className="audience-list-options">{(profile.friendLists ?? []).length ? <>{(profile.friendLists ?? []).map((list) => <label key={list.id}><input type="checkbox" checked={profile.mapProfileListIds?.includes(list.id)} onChange={(event) => patchProfile({ mapProfileListIds: event.target.checked ? [...new Set([...(profile.mapProfileListIds ?? []), list.id])] : (profile.mapProfileListIds ?? []).filter((id) => id !== list.id) })} /><span><strong>{list.name}</strong><small>{list.memberIds.length}人</small></span></label>)}<small>{profile.mapProfileListIds?.length ?? 0}件のリストを選択中</small></> : <p>フレンド画面でリストを作成すると選択できます。</p>}</div>}
          </section>
          <section className="presence-settings">
            <h3>位置情報と音楽の共有</h3>
            <div className="presence-sharing-options">
              <div className="presence-sharing-option">
                <label className="community-switch"><span><strong>位置情報を共有する</strong><small>現在地を共有相手の地図に表示します</small></span><input type="checkbox" role="switch" aria-label="位置情報を共有する" checked={Boolean(profile?.locationSharing?.enabled)} onChange={(event) => setLocationSharing(event.target.checked)} /></label>
              </div>
              <div className="presence-sharing-option">
                <label className="community-switch"><span><strong>曲名を共有する</strong><small>再生中の曲名とアーティスト名だけを共有します</small></span><input type="checkbox" role="switch" aria-label="曲名を共有する" checked={profile?.musicSharingEnabled ?? Boolean(profile?.nowPlaying)} onChange={(event) => setMusicSharing(event.target.checked)} /></label>
                {(profile?.musicSharingEnabled ?? Boolean(profile?.nowPlaying)) && <p className="automatic-sharing-status">{profile?.nowPlaying?.title ? `共有中: ${profile.nowPlaying.title}${profile.nowPlaying.artist ? ` / ${profile.nowPlaying.artist}` : ''}` : '再生情報を検出すると自動で共有します'}</p>}
              </div>
            </div>
            <div className="presence-audience" aria-labelledby="presence-audience-title">
              <h4 id="presence-audience-title">共有する相手</h4>
              <label className="sharing-scope-select"><span>公開範囲</span><select value={profile?.locationSharing?.audience ?? 'friends'} onChange={(event) => patchProfile({ locationSharing: { enabled: Boolean(profile?.locationSharing?.enabled), audience: event.target.value as 'friends' | 'lists', listIds: profile?.locationSharing?.listIds ?? [] } })}><option value="friends">フレンド全員（{friendIds.length}人）</option><option value="lists">フレンドリストから選ぶ</option></select></label>
              {profile?.locationSharing?.audience === 'lists' && <div className="audience-list-options">{(profile.friendLists ?? []).length ? <>{(profile.friendLists ?? []).map((list) => <label key={list.id}><input type="checkbox" checked={profile.locationSharing?.listIds.includes(list.id)} onChange={(event) => patchProfile({ locationSharing: { enabled: Boolean(profile.locationSharing?.enabled), audience: 'lists', listIds: event.target.checked ? [...new Set([...(profile.locationSharing?.listIds ?? []), list.id])] : (profile.locationSharing?.listIds ?? []).filter((id) => id !== list.id) } })} /><span><strong>{list.name}</strong><small>{list.memberIds.length}人</small></span></label>)}<small>{profile.locationSharing?.listIds.length ?? 0}件のリストを選択中</small></> : <p>フレンド画面でリストを作成すると選択できます。</p>}</div>}
            </div>
            <small>位置情報と音楽は個別にオン・オフできます。共有相手の設定は両方に適用されます。</small>
            {presence.length > 0 && <div className="presence-list">{presence.map((item) => <span key={item.userId}>{item.displayName}{item.nowPlaying?.title ? ` · ♪ ${item.nowPlaying.title}` : ''}{item.location ? ' · 位置共有中' : ''}</span>)}</div>}
          </section>
          <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : '共有設定を保存'}</button>
        </>}
        {settingsView === 'settings' && <>
          <ThemeSettings value={themePreference} resolvedTheme={resolvedTheme} onChange={(value) => { onThemeChange(value); patchProfile({ themePreference: value }) }} />
          {profile && <RouteDisplaySettings profile={profile} courses={courses} userId={user.uid} friendIds={friendIds} friendNames={friendNames} onChange={patchProfile} />}
          {profile && <PersonalizationSettings profile={profile} onChange={patchProfile} />}
          <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : '設定を保存'}</button>
        </>}
      </>}
      {course && <section className="social-thread">{authorProfile && <ProfileShowcase profile={authorProfile} title={`${course.authorName ?? authorProfile.displayName}のプロフィール`} />}<div className="social-actions"><button onClick={like}>{likeState.liked ? '♥ いいね済み' : '♡ いいね'} ({likeState.count})</button><button onClick={follow}>{profile?.followingIds?.includes(course.authorId) ? 'フォロー解除' : '＋ 作成者をフォロー'}</button></div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p>{item.authorId === user.uid && <button type="button" className="text-button danger-button" onClick={() => removeComment(item.id)}>削除</button>}</article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    </div></div>
  </section></div>
}
