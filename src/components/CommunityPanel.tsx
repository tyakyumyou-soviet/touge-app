import { useEffect, useState } from 'react'
import type { Course, CourseComment, UserProfile } from '../types'
import { addCourseComment, deleteCourseComment, loadUserProfile, saveUserProfileSettings, subscribeCourseComments, subscribeCourseLikes, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { postEmbedUrl, postUrlsFromText } from '../lib/profile'

interface Props { user: User | null; course?: Course | null; onClose: () => void; onLogout?: () => void; onAdminOpen?: () => void }

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

export function CommunityPanel({ user, course, onClose, onLogout, onAdminOpen }: Props) {
  const sheet = useMobileSheet()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [likeState, setLikeState] = useState({ count: 0, liked: false })
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
  async function saveProfile() { if (!user || !profile) return; setSaving(true); try { await saveUserProfileSettings(user, profile); setNotice('プロフィールを保存しました') } catch { setNotice('保存できませんでした') } finally { setSaving(false) } }
  async function postComment() { if (!user || !course || !body.trim()) return; try { await addCourseComment(course.id, body.trim(), user); setBody('') } catch { setNotice('コメントを保存できませんでした') } }
  async function removeComment(commentId: string) { if (!course) return; try { await deleteCourseComment(course.id, commentId) } catch { setNotice('コメントを削除できませんでした') } }
  async function like() { if (!user || !course) return; await toggleCourseLike(course.id, user); setNotice('いいねを更新しました') }
  async function follow() { if (!user || !course?.authorId || course.authorId === user.uid) return; await toggleFollow(course.authorId, user); setNotice('フォロー状態を更新しました') }
  function patchProfile(values: Partial<UserProfile>) { if (!user) return; setProfile((p) => ({ id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...p, ...values })) }
  return <div className="modal-backdrop" role="presentation"><section className={`modal community-panel ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="community-title">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">プロフィールと共有</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header></div>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      <section className="profile-editor"><div className="profile-avatar" aria-label="プロフィール画像">{profileImageUrl ? <img src={profileImageUrl} alt="Googleアカウントのプロフィール画像" /> : (profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label>愛車（任意）<input value={profile?.vehicleName ?? ''} onChange={(e) => patchProfile({ vehicleName: e.target.value })} placeholder="例: 86 GT MT" /></label><label>愛車メモ（任意）<input value={profile?.vehicleDetails ?? ''} onChange={(e) => patchProfile({ vehicleDetails: e.target.value })} placeholder="例: 年式・カラー・仕様" /></label><label className="wide">マップへの表示<select value={profile?.mapVisibility ?? 'friends'} onChange={(e) => patchProfile({ mapVisibility: e.target.value as UserProfile['mapVisibility'] })}><option value="all">全体に表示</option><option value="friends">フォロー相手のみ</option><option value="none">表示しない</option></select></label></div></section>
      <section className="profile-social"><h3>SNS・愛車紹介（任意）</h3><p>アカウントを共有したり、愛車の写真・動画を紹介する投稿をプロフィールに掲載できます。</p><div className="form-grid"><label>X<input value={profile?.socialLinks?.x ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, x: e.target.value } })} placeholder="https://x.com/username" /></label><label>Instagram<input value={profile?.socialLinks?.instagram ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, instagram: e.target.value } })} placeholder="https://instagram.com/username" /></label><label>YouTube<input value={profile?.socialLinks?.youtube ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, youtube: e.target.value } })} placeholder="https://youtube.com/@channel" /></label><label>TikTok<input value={profile?.socialLinks?.tiktok ?? ''} onChange={(e) => patchProfile({ socialLinks: { ...profile?.socialLinks, tiktok: e.target.value } })} placeholder="https://tiktok.com/@username" /></label><label className="wide">愛車紹介の投稿URL（任意）<textarea rows={3} value={(profile?.showcasePostUrls ?? []).join('\n')} onChange={(e) => patchProfile({ showcasePostUrls: postUrlsFromText(e.target.value) })} placeholder="愛車の写真・動画が載ったX・Instagram・YouTube・TikTokの投稿URLを1行ずつ（最大3件）" /><small>愛車紹介用の投稿として掲載します。対応投稿は埋め込み表示、その他はリンクとして表示します。</small></label></div></section>
      {profile && <ProfileShowcase profile={profile} />}
      <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button>
      {onAdminOpen && <button type="button" className="button secondary" onClick={onAdminOpen}>情報承認・編集</button>}
      {onLogout && <button type="button" className="text-button danger-button" onClick={onLogout}>ログアウト</button>}
      {course && <section className="social-thread">{authorProfile && <ProfileShowcase profile={authorProfile} title={`${course.authorName ?? authorProfile.displayName}のプロフィール`} />}<div className="social-actions"><button onClick={like}>{likeState.liked ? '♥ いいね済み' : '♡ いいね'} ({likeState.count})</button><button onClick={follow}>＋ 作成者をフォロー</button></div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p>{item.authorId === user.uid && <button type="button" className="text-button danger-button" onClick={() => removeComment(item.id)}>削除</button>}</article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </section></div>
}
