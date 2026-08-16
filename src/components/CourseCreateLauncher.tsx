import { useState, type FormEvent } from 'react'
import type { Coordinate } from '../types'

interface Props {
  onClose: () => void
  onMapCreate: () => void
  onJoinCreate: () => void
  onSearchCreate: (points: Coordinate[]) => Promise<void>
}

async function geocode(query: string): Promise<Coordinate> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&q=${encodeURIComponent(query)}`)
  if (!response.ok) throw new Error('場所を検索できませんでした')
  const items = await response.json() as Array<{ lon: string; lat: string }>
  if (!items[0]) throw new Error(`「${query}」が見つかりませんでした`)
  return [Number(items[0].lon), Number(items[0].lat)]
}

export function CourseCreateLauncher({ onClose, onMapCreate, onJoinCreate, onSearchCreate }: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const data = new FormData(event.currentTarget)
    const values = [String(data.get('start') ?? ''), String(data.get('via') ?? ''), String(data.get('goal') ?? '')].map((value) => value.trim())
    if (!values[0] || !values[2]) { setError('始点と終点を入力してください'); return }
    setBusy(true)
    try { await onSearchCreate(await Promise.all(values.filter(Boolean).map(geocode))) } catch (caught) { setError(caught instanceof Error ? caught.message : '場所を検索できませんでした') } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal create-launcher" role="dialog" aria-modal="true" aria-labelledby="create-launcher-title">
    <header><div><p className="eyebrow">NEW ROUTE</p><h2 id="create-launcher-title">コースの作り方を選ぶ</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header>
    {!searchOpen ? <div className="create-mode-grid">
      <button className="create-mode-card" onClick={onMapCreate}><span>🗺️</span><strong>地図から作成</strong><small>地図上の道路を順番にタップして指定</small></button>
      <button className="create-mode-card" onClick={() => setSearchOpen(true)}><span>🔎</span><strong>場所を検索して作成</strong><small>始点・経由地・終点から道路ルートを作成</small></button>
      <button className="create-mode-card" onClick={onJoinCreate}><span>🔗</span><strong>既存コースを連結</strong><small>お気に入りの峠を順番につないで作成</small></button>
    </div> : <form className="search-route-form" onSubmit={submitSearch}>
      <button type="button" className="text-button" onClick={() => setSearchOpen(false)}>← 作成方法に戻る</button>
      <div className="course-form-steps"><span className="active">1 地点を入力</span><b>→</b><span>2 詳細を入力</span></div>
      <label>出発地<input required name="start" placeholder="例: 熱海峠" /></label>
      <label>経由地（任意）<input name="via" placeholder="例: 玄岳IC" /></label>
      <label>到着地<input required name="goal" placeholder="例: 天城高原IC" /></label>
      <p className="form-hint">入力した地点を道路上へ補正し、次の画面でルートを確認できます。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={onClose}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '地点を検索中…' : 'ルートを確認する →'}</button></footer>
    </form>}
  </section></div>
}
