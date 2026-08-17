import { useEffect, useState } from 'react'
import type { Course, CourseComment, UserProfile } from '../types'
import { addCourseComment, deleteCourseComment, loadUserProfile, saveUserProfileSettings, subscribeCourseComments, subscribeCourseLikes, toggleCourseLike, toggleFollow } from '../lib/firebase'
import type { User } from 'firebase/auth'

type EditableCourse = Pick<Course, 'name' | 'area' | 'prefecture' | 'description' | 'tags' | 'cautions' | 'visibility'>
interface Props { user: User | null; course?: Course | null; courses: Course[]; onClose: () => void; onLogout?: () => void; onCreateJoined: (courses: Course[]) => Promise<void>; onUpdateCourse: (courseId: string, changes: EditableCourse) => Promise<void>; onDeleteCourse: (courseId: string) => Promise<void> }

export function CommunityPanel({ user, course, courses, onClose, onLogout, onCreateJoined, onUpdateCourse, onDeleteCourse }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [comments, setComments] = useState<CourseComment[]>([])
  const [body, setBody] = useState('')
  const [joined, setJoined] = useState<string[]>(course ? [course.id] : [])
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [likeState, setLikeState] = useState({ count: 0, liked: false })
  const [courseDraft, setCourseDraft] = useState<EditableCourse | null>(null)
  const [courseSaving, setCourseSaving] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  useEffect(() => { if (user) loadUserProfile(user.uid).then(setProfile).catch(() => undefined) }, [user])
  useEffect(() => {
    if (!course) { setComments([]); return }
    return subscribeCourseComments(course.id, setComments, () => setNotice('コメントを同期できませんでした'))
  }, [course])
  useEffect(() => {
    if (!course) { setLikeState({ count: 0, liked: false }); return }
    return subscribeCourseLikes(course.id, user?.uid, setLikeState)
  }, [course, user?.uid])
  useEffect(() => {
    setDeleteArmed(false)
    setCourseDraft(course && user?.uid === course.authorId ? { name: course.name, area: course.area, prefecture: course.prefecture, description: course.description, tags: course.tags, cautions: course.cautions, visibility: course.visibility } : null)
  }, [course, user?.uid])
  async function saveProfile() { if (!user || !profile) return; setSaving(true); try { await saveUserProfileSettings(user, profile); setNotice('プロフィールを保存しました') } catch { setNotice('保存できませんでした') } finally { setSaving(false) } }
  async function postComment() { if (!user || !course || !body.trim()) return; try { await addCourseComment(course.id, body.trim(), user); setBody('') } catch { setNotice('コメントを保存できませんでした') } }
  async function removeComment(commentId: string) { if (!course) return; try { await deleteCourseComment(course.id, commentId) } catch { setNotice('コメントを削除できませんでした') } }
  async function like() { if (!user || !course) return; await toggleCourseLike(course.id, user); setNotice('いいねを更新しました') }
  async function follow() { if (!user || !course?.authorId || course.authorId === user.uid) return; await toggleFollow(course.authorId, user); setNotice('フォロー状態を更新しました') }
  async function saveCourse() { if (!course || !courseDraft) return; setCourseSaving(true); try { await onUpdateCourse(course.id, courseDraft); setNotice('コース情報をFirebaseへ保存しました') } catch { setNotice('コース情報を保存できませんでした') } finally { setCourseSaving(false) } }
  async function removeCourse() { if (!course) return; if (!deleteArmed) { setDeleteArmed(true); setNotice('もう一度「削除を確定」を押すとFirebaseから削除します'); return } try { await onDeleteCourse(course.id); onClose() } catch { setNotice('コースを削除できませんでした') } }
  function patchProfile(values: Partial<UserProfile>) { if (!user) return; setProfile((p) => ({ id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends', followingIds: [], followerCount: 0, ...p, ...values })) }
  return <div className="modal-backdrop" role="presentation"><section className="modal community-panel" role="dialog" aria-modal="true" aria-labelledby="community-title">
    <header><div><p className="eyebrow">COMMUNITY</p><h2 id="community-title">プロフィールと共有</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header>
    {!user ? <div className="empty-state"><p>ログインするとプロフィール編集、フォロー、コメント、いいねが使えます。</p></div> : <>
      <section className="profile-editor"><div className="profile-avatar">{(profile?.displayName || user.displayName || 'ド').slice(0, 1)}</div><div className="form-grid"><label>表示名<input value={profile?.displayName ?? user.displayName ?? ''} onChange={(e) => patchProfile({ displayName: e.target.value })} /></label><label>ホームエリア<input value={profile?.homeArea ?? ''} onChange={(e) => patchProfile({ homeArea: e.target.value })} /></label><label className="wide">自己紹介<textarea rows={2} value={profile?.bio ?? ''} onChange={(e) => patchProfile({ bio: e.target.value })} /></label><label className="wide">マップへの表示<select value={profile?.mapVisibility ?? 'friends'} onChange={(e) => patchProfile({ mapVisibility: e.target.value as UserProfile['mapVisibility'] })}><option value="all">全体に表示</option><option value="friends">フォロー相手のみ</option><option value="none">表示しない</option></select></label></div></section>
      <button className="button primary" onClick={saveProfile} disabled={saving}>{saving ? '保存中…' : 'プロフィールを保存'}</button>
      {onLogout && <button className="text-button" onClick={onLogout}>ログアウト</button>}
      {courseDraft && <section className="join-course"><h3>自分のコースを編集</h3><div className="form-grid"><label>コース名<input value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} /></label><label>エリア<input value={courseDraft.area} onChange={(e) => setCourseDraft({ ...courseDraft, area: e.target.value })} /></label><label>公開範囲<select value={courseDraft.visibility} onChange={(e) => setCourseDraft({ ...courseDraft, visibility: e.target.value as Course['visibility'] })}><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label><label className="wide">説明<textarea rows={2} value={courseDraft.description} onChange={(e) => setCourseDraft({ ...courseDraft, description: e.target.value })} /></label><label className="wide">タグ<input value={courseDraft.tags.join('、')} onChange={(e) => setCourseDraft({ ...courseDraft, tags: e.target.value.split(/[,、]/).map((item) => item.trim()).filter(Boolean) })} /></label><label className="wide">注意事項<textarea rows={2} value={courseDraft.cautions.join('\n')} onChange={(e) => setCourseDraft({ ...courseDraft, cautions: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label></div><div className="secondary-actions"><button onClick={saveCourse} disabled={courseSaving}>{courseSaving ? '保存中…' : '変更を保存'}</button><button className={deleteArmed ? 'danger-action' : ''} onClick={removeCourse}>{deleteArmed ? '削除を確定' : 'コースを削除'}</button></div></section>}
      <section className="join-course"><h3>コースを連結してオリジナル作成</h3><p>選んだ順に道順をつなぎ、限定公開・フレンド共有のコースとして保存できます。</p><div className="join-options">{courses.map((item) => <label key={item.id}><input type="checkbox" checked={joined.includes(item.id)} onChange={(e) => setJoined((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />{item.name}</label>)}</div><button className="button secondary" disabled={joined.length < 2} onClick={() => onCreateJoined(joined.map((id) => courses.find((item) => item.id === id)).filter((item): item is Course => Boolean(item)))}>連結コースを保存</button></section>
      {course && <section className="social-thread"><div className="social-actions"><button onClick={like}>{likeState.liked ? '♥ いいね済み' : '♡ いいね'} ({likeState.count})</button><button onClick={follow}>＋ 作成者をフォロー</button></div><h3>{course.name}へのコメント</h3><div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p>{item.authorId === user.uid && <button type="button" className="text-button" onClick={() => removeComment(item.id)}>削除</button>}</article>) : <p className="muted">まだコメントはありません。</p>}</div><form onSubmit={(e) => { e.preventDefault(); postComment() }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="走行後の感想を書く" /><button className="button primary">投稿</button></form></section>}
    </>}
    {notice && <p className="form-success" role="status">{notice}</p>}
  </section></div>
}
