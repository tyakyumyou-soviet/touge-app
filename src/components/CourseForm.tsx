import { useState, type FormEvent } from 'react'
import type { Coordinate, CourseDraft } from '../types'
import { routeDistanceKm } from '../lib/course'

interface Props {
  route: Coordinate[]
  onUndo: () => void
  onCancel: () => void
  onSave: (draft: CourseDraft) => Promise<void>
}

export function CourseForm({ route, onUndo, onCancel, onSave }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (route.length < 2) { setError('地図上で始点と終点を指定してください。'); return }
    const data = new FormData(event.currentTarget)
    const draft: CourseDraft = {
      name: String(data.get('name')),
      area: String(data.get('area')),
      prefecture: String(data.get('prefecture')) as CourseDraft['prefecture'],
      description: String(data.get('description')),
      route,
      tags: String(data.get('tags')).split(/[,、]/).map((item) => item.trim()).filter(Boolean),
      cautions: String(data.get('cautions')).split('\n').map((item) => item.trim()).filter(Boolean),
      visibility: String(data.get('visibility')) as CourseDraft['visibility'],
    }
    setBusy(true)
    try { await onSave(draft) } catch { setError('保存できませんでした。通信状態とFirebase設定を確認してください。') } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal course-form" onSubmit={submit} aria-labelledby="course-form-title">
        <header><div><p className="eyebrow">NEW ROUTE</p><h2 id="course-form-title">峠コースを登録</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
        <p className="route-status">地図をクリックしてルートを描画 · {route.length}地点 · 約{routeDistanceKm(route).toFixed(1)}km</p>
        <button type="button" className="text-button" onClick={onUndo} disabled={!route.length}>最後の地点を戻す</button>
        <div className="form-grid">
          <label>コース名<input required name="name" placeholder="例: 箱根ターンパイク" /></label>
          <label>エリア<input required name="area" placeholder="例: 小田原〜大観山" /></label>
          <label>都県<select name="prefecture"><option>東京都</option><option>神奈川県</option><option>静岡県</option></select></label>
          <label>公開範囲<select name="visibility"><option value="public">一般公開</option><option value="limited">限定公開</option><option value="private">非公開</option></select></label>
          <label className="wide">説明<textarea required name="description" rows={3} placeholder="コースの特徴やおすすめポイント" /></label>
          <label className="wide">タグ<input name="tags" placeholder="ワイド、高原、展望（読点区切り）" /></label>
          <label className="wide">注意事項<textarea name="cautions" rows={2} placeholder="1行に1件。通行規制や狭路など" /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '保存中…' : 'コースを保存'}</button></footer>
      </form>
    </div>
  )
}
