import { useEffect, useState, type FormEvent } from 'react'
import type { Course, TollStatus, UserProfile } from '../types'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { JAPANESE_PREFECTURES } from '../lib/administrativeAreas'
import { loadCourseAudience } from '../lib/firebase'

export type EditableCourse = Pick<Course, 'name' | 'area' | 'prefecture' | 'description' | 'tags' | 'cautions' | 'tollStatus' | 'visibility' | 'publicSharingConfirmed' | 'allowedViewerIds'> & {
  audienceMode: 'all-friends' | 'lists'
  selectedFriendListIds: string[]
  selectedFriendListNames: Record<string, string>
  preserveAudience?: boolean
}

interface Props {
  course: Course
  profile?: UserProfile | null
  onClose: () => void
  onSave: (courseId: string, changes: EditableCourse) => Promise<void>
  onDelete: (courseId: string) => Promise<void>
  onEditRoute: () => void
  audienceReadOnly?: boolean
}

export function CourseManageForm({ course, profile, onClose, onSave, onDelete, onEditRoute, audienceReadOnly = false }: Props) {
  const sheet = useMobileSheet()
  const [draft, setDraft] = useState<EditableCourse>(() => ({
    name: course.name, area: course.area, prefecture: course.prefecture, description: course.description,
    tags: course.tags, cautions: course.cautions, tollStatus: course.tollStatus ?? course.tollInfo?.type ?? 'unknown', visibility: 'limited', publicSharingConfirmed: false, allowedViewerIds: course.allowedViewerIds ?? [], audienceMode: 'all-friends', selectedFriendListIds: [], selectedFriendListNames: {},
  }))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    loadCourseAudience(course.id).then((audience) => {
      if (active && audience) setDraft((value) => ({ ...value, audienceMode: audience.mode, selectedFriendListIds: audience.listIds, selectedFriendListNames: audience.listNames }))
    }).catch(() => undefined)
    return () => { active = false }
  }, [course.id])

  function viewerIds(value = draft) {
    if (value.audienceMode === 'all-friends') return profile?.followingIds ?? []
    return (profile?.friendLists ?? []).filter((list) => value.selectedFriendListIds.includes(list.id)).flatMap((list) => list.memberIds)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setNotice('')
    try { await onSave(course.id, { ...draft, visibility: 'limited', publicSharingConfirmed: false, allowedViewerIds: audienceReadOnly ? (course.allowedViewerIds ?? []) : [...new Set(viewerIds())], preserveAudience: audienceReadOnly }); setNotice('変更をFirebaseへ保存しました') }
    catch { setNotice('保存できませんでした。通信状態とログイン状態を確認してください') }
    finally { setSaving(false) }
  }

  async function remove() {
    if (!deleteArmed) { setDeleteArmed(true); return }
    setDeleting(true); setNotice('')
    try { await onDelete(course.id); onClose() }
    catch { setNotice('削除できませんでした。通信状態とログイン状態を確認してください') }
    finally { setDeleting(false) }
  }

  return <div className="modal-backdrop" role="presentation"><section className={`modal course-manager ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="course-manager-title" {...sheet.dragProps} data-sheet-scroll {...sheet.scrollProps}>
    <div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">MY COURSE</p><h2 id="course-manager-title">コース情報を編集</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="編集画面を閉じる">×</button></header></div>
    <div className="course-manager-summary"><strong>{course.name}</strong><span>{course.distanceKm} km · {course.durationMin}分 · 登録済みルートは維持されます</span></div>
    <section className="course-manager-section course-route-edit"><div><h3>ルートを編集</h3><p>地点の追加・削除・並び替え、既存コースや提案コースの組み込みを行えます。保存するとこのコース自体を更新します。</p></div><button type="button" className="button secondary" onClick={onEditRoute}>ルートを編集</button></section>
    <form onSubmit={save}>
      <section className="course-manager-section"><h3>基本情報</h3><div className="form-grid"><label>コース名<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>エリア<input required value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value })} /></label><label>都道府県<input value={draft.prefecture} list="course-manager-prefecture-suggestions" onChange={(event) => setDraft({ ...draft, prefecture: event.target.value })} /><small>複数ある場合は「・」で区切ります。</small></label><datalist id="course-manager-prefecture-suggestions">{JAPANESE_PREFECTURES.map((item) => <option key={item} value={item} />)}</datalist></div></section>
      <section className="course-manager-section"><h3>紹介と走行メモ</h3><div className="form-grid"><label className="wide">説明（任意）<textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>料金区分<select value={draft.tollStatus} onChange={(event) => setDraft({ ...draft, tollStatus: event.target.value as TollStatus })}><option value="unknown">料金情報未確認</option><option value="free">無料</option><option value="toll">有料</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select></label><label className="wide">タグ（任意）<input value={draft.tags.join('、')} onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(/[,、]/).map((item) => item.trim()).filter(Boolean) })} placeholder="ワイド、展望、高原" /></label><label className="wide">注意事項（任意）<textarea rows={3} value={draft.cautions.join('\n')} onChange={(event) => setDraft({ ...draft, cautions: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} placeholder="1行に1件" /></label></div></section>
      <section className="course-manager-section audience-picker"><h3>公開するフレンド</h3><p>この設定を確認できるのは、作成者と管理者以上だけです。</p>{audienceReadOnly ? <div className="audience-readonly"><strong>{draft.audienceMode === 'all-friends' ? 'フレンド全員' : '選択したフレンドリスト'}</strong>{draft.audienceMode === 'lists' && <div>{draft.selectedFriendListIds.map((id) => <span key={id}>{draft.selectedFriendListNames[id] ?? id}</span>)}</div>}<small>管理者は適用内容を確認できます。変更はコース作成者のみ行えます。</small></div> : <><label className={`audience-option ${draft.audienceMode === 'all-friends' ? 'selected' : ''}`}><input type="radio" name="managed-course-audience" checked={draft.audienceMode === 'all-friends'} onChange={() => setDraft({ ...draft, audienceMode: 'all-friends' })} /><span><strong>フレンド全員</strong><small>{profile?.followingIds?.length ?? 0}人</small></span></label><label className={`audience-option ${draft.audienceMode === 'lists' ? 'selected' : ''}`}><input type="radio" name="managed-course-audience" checked={draft.audienceMode === 'lists'} onChange={() => setDraft({ ...draft, audienceMode: 'lists' })} /><span><strong>フレンドリストを選ぶ</strong><small>複数選択できます</small></span></label>{draft.audienceMode === 'lists' && <div className="audience-list-options">{(profile?.friendLists ?? []).length ? (profile?.friendLists ?? []).map((list) => <label key={list.id}><input type="checkbox" checked={draft.selectedFriendListIds.includes(list.id)} onChange={(event) => setDraft((value) => ({ ...value, selectedFriendListIds: event.target.checked ? [...new Set([...value.selectedFriendListIds, list.id])] : value.selectedFriendListIds.filter((id) => id !== list.id), selectedFriendListNames: { ...value.selectedFriendListNames, [list.id]: list.name } }))} /><span><strong>{list.name}</strong><small>{list.memberIds.length}人</small></span></label>) : <p>作成済みのフレンドリストはありません。</p>}</div>}</>}</section>
      {notice && <p className="form-success" role="status">{notice}</p>}
      <footer className="course-manager-actions"><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button className="button primary" disabled={saving}>{saving ? '保存中…' : '変更を保存'}</button></footer>
    </form>
    <section className={`course-manager-danger ${deleteArmed ? 'armed' : ''}`}><div><h3>コースを削除</h3><p>{deleteArmed ? 'この操作は取り消せません。関連する評価・いいね・コメントも削除されます。' : '登録したコースと関連データをFirebaseから削除します。'}</p></div><button className="button secondary" type="button" onClick={remove} disabled={deleting}>{deleting ? '削除中…' : deleteArmed ? '削除を確定' : '削除する'}</button></section>
  </section></div>
}
