import { useEffect, useState } from 'react'
import type { Course, CourseComment, UserProfile } from '../types'
import { addCourseComment, loadCourseComments, loadUserProfile, saveUserProfileSettings, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'

interface Props { user: User | null; course?: Course | null; courses: Course[]; onClose: () => void; onLogout?: () => void; onCreateJoined: (courses: Course[]) => Promise<void> }

export function CommunityPanel({ user, course, courses, onClose, onLogout, onCreateJoined }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [joined, setJoined] = useState<string[]>(course ? [course.id] : [])
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (user) loadUserProfile(user.uid).then(setProfile).catch(() => undefined) }, [user])
  useEffect(() => { if (course) loadCourseComments(course.id).then(setComments).catch(() => undefined) }, [course])
  async function saveProfile() { if (!user || !profile) return; setSaving(true); try { await saveUserProfileSettings(user, profile); setNotice('プロフィールを保存しました') } catch { setNotice('保存できませんでした') } finally { setSaving(false) } }
  async function postComment() { if (!user || !course || !body.trim()) return; await addCourseComment(course.id, body.trim(), user); setComments((items) => [...items, { id: crypto.randomUUID(), courseId: course.id, authorId: user.uid, authorName: user.displayName ?? 'ドライバー', body: body.trim(), likeCount: 0 }]); setBody('') }
  async function like() { if (!user || !course) return; await toggleCourseLike(course.id, user); setNotice('いいねを更新しました') }
  async function follow() { if (!user || !course?.authorId || course.authorId === user.uid) return; await toggleFollow(course.authorId, user); setNotice('フォロー状態を更新しました') }
  function patchProfile(values: Partial<UserProfile>) { if (!user) return; setProfile((p) => ({ id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...p, ...values })) }
  return <div className="modal-backdrop" role="presentation"><section className="modal community-panel" role="dialog" aria-modal="true" aria-labelledby="community-title">
    <header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">プロフィールと共有</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      <section className="profile-editor"><div className="profile-avatar">{(profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label className="wide">マップへの表示<select value={profile?.mapVisibility ?? 'friends'} onChange={(e) => patchProfile({ mapVisibility: e.target.value as UserProfile['mapVisibility'] })}><option value="all">全体に表示</option><option value="friends">フォロー相手のみ</option><option value="none">表示しない</option></select></label></div></section>
      <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button>
      {onLogout && <button className="text-button" onClick={onLogout}>ログアウト</button>}
      <section className="join-course"><h3>コースを連結してオリジナル作成</h3><p>選んだ順に道順をつなぎ、限定公開・フレンド共有のコースとして保存できます。</p><div className="join-options">{courses.map((item) => <label key={item.id}><input type="checkbox" checked={joined.includes(item.id)} onChange={(e) => setJoined((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />{item.name}</label>)}</div><button className="button secondary" disabled={joined.length < 2} onClick={() => onCreateJoined(joined.map((id) => courses.find((item) => item.id === id)).filter((item): item is Course => Boolean(item)))}>連結コースを保存</button></section>
      {course && <section className="social-thread"><div className="social-actions"><button onClick={like}>♡ いいね</button><button onClick={follow}>＋ 作成者をフォロー</button></div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p></article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </section></div>
}
