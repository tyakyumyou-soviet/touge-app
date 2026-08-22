import { useEffect, useState } from 'react'
import type { Course, CourseComment, FriendPresence, UserProfile } from '../types'
import { addCourseComment, clearFriendPresence, deleteCourseComment, loadUserProfile, saveFriendPresence, saveUserProfileSettings, subscribeCourseComments, subscribeCourseLikes, subscribeFriendPresence, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { postEmbedUrl, postUrlsFromText } from '../lib/profile'

interface Props { user: User | null; course?: Course | null; onClose: () => void; onLogout?: () => void; onAdminOpen?: () => void; onProfileSaved?: (profile: UserProfile) => void }

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

export function CommunityPanel({ user, course, onClose, onLogout, onAdminOpen, onProfileSaved }: Props) {
  const sheet = useMobileSheet()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [likeState, setLikeState] = useState({ count: 0, liked: false })
  const [friendListName, setFriendListName] = useState('')
  const [nowPlaying, setNowPlaying] = useState('')
  const [presence, setPresence] = useState<FriendPresence[]>([])
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({})
  const profileImageUrl = profile?.photoURL ?? user?.photoURL
  useEffect(() => { if (user) loadUserProfile(user.uid).then(setProfile).catch(() => undefined) }, [user])
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
    if (!profile?.followingIds?.length) { setPresence([]); return }
    return subscribeFriendPresence(profile.followingIds, setPresence)
  }, [profile?.followingIds])
  useEffect(() => {
    if (!profile?.followingIds?.length) { setFriendProfiles({}); return }
    Promise.all(profile.followingIds.map((id) => loadUserProfile(id).then((item) => [id, item] as const).catch(() => [id, null] as const))).then((items) => setFriendProfiles(Object.fromEntries(items.filter((item): item is readonly [string, UserProfile] => Boolean(item[1])))))
  }, [profile?.followingIds])
  function saveProfile() {
    if (!user || !profile) return
    setSaving(true); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(profile)); onProfileSaved?.(profile)
    void saveUserProfileSettings(user, profile).then(() => setNotice(navigator.onLine ? 'プロフィールを保存しました' : 'オフラインで保存しました。接続回復後に同期します')).catch(() => setNotice('端末には保存しました。Firebaseとの同期を再試行します')).finally(() => setSaving(false))
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
  function toggleGlobalBlock(targetId: string) {
    if (!user || !profile) return
    const blocked = profile.blockedUserIds?.includes(targetId) ? (profile.blockedUserIds ?? []).filter((id) => id !== targetId) : [...new Set([...(profile.blockedUserIds ?? []), targetId])]
    const next = { ...profile, blockedUserIds: blocked }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    void saveUserProfileSettings(user, { blockedUserIds: blocked })
    setNotice(blocked.includes(targetId) ? 'このユーザーをすべての共有対象から外しました' : '共有ブロックを解除しました')
  }
  function addFriendList() {
    const name = friendListName.trim()
    if (!name) return
    patchProfile({ friendLists: [...(profile?.friendLists ?? []), { id: crypto.randomUUID(), name, memberIds: [] }] })
    setFriendListName('')
  }
  function toggleFriendInList(listId: string, userId: string) {
    patchProfile({ friendLists: (profile?.friendLists ?? []).map((list) => list.id !== listId ? list : { ...list, memberIds: list.memberIds.includes(userId) ? list.memberIds.filter((id) => id !== userId) : [...list.memberIds, userId] }) })
  }
  function viewerIds(nextProfile = profile) {
    const blocked = new Set(nextProfile?.blockedUserIds ?? [])
    const selected = new Set(nextProfile?.locationSharing?.listIds ?? [])
    const ids = nextProfile?.locationSharing?.audience === 'lists'
      ? (nextProfile.friendLists ?? []).filter((list) => selected.has(list.id)).flatMap((list) => list.memberIds)
      : nextProfile?.followingIds ?? []
    return [...new Set(ids.filter((id) => !blocked.has(id)))]
  }
  function setLocationSharing(enabled: boolean) {
    if (!user) return
    if (enabled && !navigator.geolocation) { setNotice('この端末では位置情報を利用できません'); return }
    const next = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), locationSharing: { ...(profile?.locationSharing ?? { audience: 'friends' as const, listIds: [] }), enabled } }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    void saveUserProfileSettings(user, { locationSharing: next.locationSharing })
    if (!enabled && !profile?.nowPlaying) void clearFriendPresence(user.uid)
    setNotice(enabled ? '位置共有をオンにしました。端末の許可後に更新を開始します' : '位置共有をオフにしました')
  }
  async function shareNowPlaying() {
    if (!user) return
    const title = nowPlaying.trim() || navigator.mediaSession?.metadata?.title || ''
    if (!title) { setNotice('再生中の曲名を入力してください。外部音楽アプリの曲名はブラウザから自動取得できない場合があります。'); return }
    setNowPlaying(title)
    const playing = { title, artist: navigator.mediaSession?.metadata?.artist || undefined, updatedAt: new Date().toISOString() }
    const next = { ...(profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }), nowPlaying: playing }
    setProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); onProfileSaved?.(next)
    try {
      await Promise.all([
        saveFriendPresence(user, { allowedViewerIds: viewerIds(next), nowPlaying: playing, ...(next.locationSharing?.enabled ? {} : { location: null }) }),
        saveUserProfileSettings(user, { nowPlaying: playing }),
      ])
      setNotice('再生中の曲名を共有しました')
    } catch {
      setNotice('曲名を端末に保存しました。接続回復後にもう一度共有してください。')
    }
  }
  function patchProfile(values: Partial<UserProfile>) { if (!user) return; setProfile((p) => ({ id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...p, ...values })) }
  const friendName = (id: string) => friendProfiles[id]?.displayName || id.slice(0, 8)
  return <div className="modal-backdrop" role="presentation"><section className={`modal community-panel ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="community-title">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">プロフィールと共有</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header></div>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      <section className="profile-editor"><div className="profile-avatar" aria-label="プロフィール画像">{profileImageUrl ? <img src={profileImageUrl} alt="Googleアカウントのプロフィール画像" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label>愛車（任意）<input value={profile?.vehicleName ?? ''} onChange={(e) => patchProfile({ vehicleName: e.target.value })} placeholder="例: 86 GT MT" /></label><label>愛車メモ（任意）<input value={profile?.vehicleDetails ?? ''} onChange={(e) => patchProfile({ vehicleDetails: e.target.value })} placeholder="例: 年式・カラー・仕様" /></label><label className="wide">マップへの表示<select value={profile?.mapVisibility ?? 'friends'} onChange={(e) => patchProfile({ mapVisibility: e.target.value as UserProfile['mapVisibility'] })}><option value="all">全体に表示</option><option value="friends">フォロー相手のみ</option><option value="none">表示しない</option></select></label></div></section>
      <section className="profile-social"><h3>SNS・愛車紹介（任意）</h3><p>アカウントを共有したり、愛車の写真・動画を紹介する投稿をプロフィールに掲載できます。</p><div className="form-grid"><label>X<input value={profile?.socialLinks?.x ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, x: e.target.value } })} placeholder="https://x.com/username" /></label><label>Instagram<input value={profile?.socialLinks?.instagram ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/username" /></label><label>YouTube<input value={profile?.socialLinks?.youtube ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, youtube: e.target.value } })} placeholder="https://youtube.com/@channel" /></label><label>TikTok<input value={profile?.socialLinks?.tiktok ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, tiktok: e.target.value } })} placeholder="https://tiktok.com/@username" /></label><label className="wide">愛車紹介の投稿URL（任意）<textarea rows={3} value={(profile?.showcasePostUrls ?? []).join('\n')} onChange={(e) => patchProfile({ showcasePostUrls: postUrlsFromText(e.target.value) })} placeholder="愛車の写真・動画が載ったX・Instagram・YouTube・TikTokの投稿URLを1行ずつ（最大3件）" /><small>愛車紹介用の投稿として掲載します。対応投稿は埋め込み表示、その他はリンクとして表示します。</small></label></div></section>
      {profile && <ProfileShowcase profile={profile} />}
      <section className="friend-settings"><h3>フレンド・共有リスト</h3><p>同じ相手を複数のリストへ登録できます。コース編集画面で「全員」またはリスト単位の共有先に使えます。</p><div className="inline-form"><input value={friendListName} onChange={(event) => setFriendListName(event.target.value)} placeholder="例: 伊豆ドライブ仲間" /><button type="button" className="button secondary" onClick={addFriendList}>リストを追加</button></div>{(profile?.friendLists ?? []).map((list) => <article key={list.id}><div className="friend-list-heading"><strong>{list.name}</strong><button type="button" className="text-button danger-button" onClick={() => patchProfile({ friendLists: (profile?.friendLists ?? []).filter((item) => item.id !== list.id) })}>削除</button></div>{(profile?.followingIds ?? []).length ? <div className="friend-members">{profile!.followingIds.map((id) => <label key={id}><input type="checkbox" checked={list.memberIds.includes(id)} onChange={() => toggleFriendInList(list.id, id)} /> {friendName(id)}</label>)}</div> : <small>先にコース作成者をフォローすると追加できます。</small>}</article>)}</section>
      <section className="friend-settings"><h3>共有しないユーザー</h3><p>指定した相手は、すべてのコースと位置・曲名共有の対象から外れます。</p>{(profile?.followingIds ?? []).length ? profile!.followingIds.map((id) => <label key={id} className="toggle-row"><input type="checkbox" checked={Boolean(profile?.blockedUserIds?.includes(id))} onChange={(event) => patchProfile({ blockedUserIds: event.target.checked ? [...new Set([...(profile?.blockedUserIds ?? []), id])] : (profile?.blockedUserIds ?? []).filter((item) => item !== id) })} /> {friendName(id)} を全共有から除外</label>) : <small>フォロー中のユーザーはいません。</small>}</section>
      <section className="presence-settings"><h3>位置情報・再生中の音楽</h3><label className="toggle-row"><input type="checkbox" checked={Boolean(profile?.locationSharing?.enabled)} onChange={(event) => setLocationSharing(event.target.checked)} /> 位置情報を共有する</label><label>共有相手<select value={profile?.locationSharing?.audience ?? 'friends'} onChange={(event) => patchProfile({ locationSharing: { enabled: Boolean(profile?.locationSharing?.enabled), listIds: profile?.locationSharing?.listIds ?? [], audience: event.target.value as 'friends' | 'lists' } })}><option value="friends">フレンド全員</option><option value="lists">選択したリストのみ</option></select></label>{profile?.locationSharing?.audience === 'lists' && <div className="friend-members">{(profile.friendLists ?? []).map((list) => <label key={list.id}><input type="checkbox" checked={profile.locationSharing?.listIds.includes(list.id)} onChange={(event) => patchProfile({ locationSharing: { enabled: Boolean(profile.locationSharing?.enabled), audience: 'lists', listIds: event.target.checked ? [...new Set([...(profile.locationSharing?.listIds ?? []), list.id])] : (profile.locationSharing?.listIds ?? []).filter((id) => id !== list.id) } })} />{list.name}</label>)}</div>}<small>初期状態はオフです。設定画面を閉じてもオンの間は更新し、オフにすると位置を削除します。</small><div className="inline-form"><input value={nowPlaying} onChange={(event) => setNowPlaying(event.target.value)} placeholder="再生中の曲名（任意）" /><button type="button" className="button secondary" onClick={() => void shareNowPlaying()}>曲名を共有</button></div><small>ブラウザが再生情報を提供する場合は自動取得し、それ以外は入力した曲名を共有します。</small>{presence.length > 0 && <div className="presence-list">{presence.map((item) => <span key={item.userId}>{item.displayName}{item.nowPlaying?.title ? ` · ♪ ${item.nowPlaying.title}` : ''}{item.location ? ' · 位置共有中' : ''}</span>)}</div>}</section>
      <section className="route-display-settings"><h3>地図上のルート表示</h3><select value={profile?.mapRouteVisibility ?? 'all'} onChange={(event) => patchProfile({ mapRouteVisibility: event.target.value as UserProfile['mapRouteVisibility'] })}><option value="all">すべて表示</option><option value="friends">フレンド・自分のみ</option><option value="mine">自分のコースのみ</option><option value="none">ルートを表示しない</option></select></section>
      <section className="personalization-settings"><h3>パーソナライズを設定</h3><p>中央は「どちらでも」、左右は好みの方向です。回答に近い道路を上位へ並べます。</p>{([['curves', '直線的', 'くねくね'], ['width', '狭い道', '広い道'], ['elevation', '平坦', '高低差'], ['scenery', '走り重視', '景色重視'], ['surface', '荒れた路面', '滑らか'], ['traffic', '賑やか', '交通量少なめ'], ['access', '秘境寄り', '行きやすい']] as const).map(([key, low, high]) => <label key={key}><span>{low}</span><input aria-label={`${low}から${high}`} type="range" min="1" max="5" step="1" value={profile?.personalization?.[key] ?? 3} onChange={(event) => patchProfile({ personalization: { curves: 3, elevation: 3, width: 3, scenery: 3, surface: 3, traffic: 3, access: 3, ...profile?.personalization, [key]: Number(event.target.value) } })} /><span>{high}</span><output>{profile?.personalization?.[key] ?? 3}</output></label>)}</section>
      <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button>
      {onAdminOpen && <button type="button" className="button secondary" onClick={onAdminOpen}>情報承認・編集</button>}
      {onLogout && <button type="button" className="text-button danger-button" onClick={onLogout}>ログアウト</button>}
      {course && <section className="social-thread">{authorProfile && <ProfileShowcase profile={authorProfile} title={`${course.authorName ?? authorProfile.displayName}のプロフィール`} />}<div className="social-actions"><button onClick={like}>{likeState.liked ? '♥ いいね済み' : '♡ いいね'} ({likeState.count})</button><button onClick={follow}>{profile?.followingIds?.includes(course.authorId) ? 'フォロー解除' : '＋ 作成者をフォロー'}</button>{course.authorId !== user.uid && <button className="danger-button" onClick={() => toggleGlobalBlock(course.authorId)}>{profile?.blockedUserIds?.includes(course.authorId) ? '共有ブロックを解除' : 'このユーザーへ共有しない'}</button>}</div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p>{item.authorId === user.uid && <button type="button" className="text-button danger-button" onClick={() => removeComment(item.id)}>削除</button>}</article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </section></div>
}
