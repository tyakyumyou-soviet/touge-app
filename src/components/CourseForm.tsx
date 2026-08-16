import { useMemo, useState, type FormEvent } from 'react'
import type { Coordinate, Course, CourseDraft } from '../types'
import { routeDistanceKm } from '../lib/course'

interface Props {
  route: Coordinate[]
  courses: Course[]
  onAddPoint: (point: Coordinate) => void
  onAddCourse: (course: Course) => void
  onUndo: () => void
  onClear: () => void
  onCancel: () => void
  onSave: (draft: CourseDraft) => Promise<void>
}

async function geocode(query: string): Promise<Coordinate> {
  const normalized = /日本|東京都|神奈川県|静岡県/.test(query) ? query : `${query}, 日本`
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=jp&q=${encodeURIComponent(normalized)}`)
  if (!response.ok) throw new Error('場所を検索できませんでした')
  const items = await response.json() as Array<{ lon: string; lat: string }>
  if (!items[0]) throw new Error(`「${query}」が見つかりませんでした`)
  return [Number(items[0].lon), Number(items[0].lat)]
}

export function CourseForm({ route, courses, onAddPoint, onAddCourse, onUndo, onClear, onCancel, onSave }: Props) {
  const [stage, setStage] = useState<'route' | 'details'>('route')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const courseMatches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('ja')
    if (!value) return []
    return courses.filter((course) => `${course.name}${course.area}${course.tags.join('')}`.toLocaleLowerCase('ja').includes(value)).slice(0, 3)
  }, [courses, query])

  async function addSearchedPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (!query.trim()) return
    setBusy(true)
    try { onAddPoint(await geocode(query.trim())); setQuery('') } catch (caught) { setError(caught instanceof Error ? caught.message : '場所を検索できませんでした') } finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (route.length < 2) { setError('地図上で始点と終点を指定してください。'); setStage('route'); return }
    const data = new FormData(event.currentTarget)
    const draft: CourseDraft = {
      name: String(data.get('name')), area: String(data.get('area')), prefecture: String(data.get('prefecture')) as CourseDraft['prefecture'], description: String(data.get('description')), route,
      tags: String(data.get('tags')).split(/[,、]/).map((item) => item.trim()).filter(Boolean), cautions: String(data.get('cautions')).split('\n').map((item) => item.trim()).filter(Boolean), visibility: String(data.get('visibility')) as CourseDraft['visibility'],
    }
    setBusy(true); setError('')
    try { await onSave(draft) } catch (caught: unknown) {
      const code = typeof caught === 'object' && caught && 'code' in caught ? String(caught.code) : ''
      const message = caught instanceof Error ? caught.message : ''
      if (code.includes('permission-denied') || code.includes('unauthenticated') || message === 'Authentication required') setError('保存にはGoogleログインが必要です。ログイン状態とFirestoreルールを確認してください。')
      else if (message.includes('道路ルート') || message.includes('道路で結べ')) setError(`${message}。地点を道路上に置き直してください。`)
      else if (message.includes('ルート検証')) setError(message)
      else if (code.includes('unavailable') || code.includes('network')) setError('Firebaseに接続できませんでした。通信状態を確認して、もう一度お試しください。')
      else setError(`保存できませんでした${message ? `: ${message}` : '。入力内容とFirebase設定を確認してください。'}`)
    } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation"><section className="modal course-form" aria-label="ルートビルダー">
    <header><div><p className="eyebrow">ROUTE BUILDER</p><h2>コースを作る</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
    <div className="course-form-steps"><span className={stage === 'route' ? 'active' : 'done'}>1 ルート</span><b>→</b><span className={stage === 'details' ? 'active' : ''}>2 詳細・公開</span></div>
    {stage === 'route' ? <div className="route-builder-stage">
      <form className="route-search" onSubmit={addSearchedPlace}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="地名・住所・IC・峠・コースを検索" aria-label="ルートへ追加する場所または住所を検索" /><button disabled={busy}>{busy ? '検索中…' : '追加'}</button></form>
      {courseMatches.length > 0 && <div className="route-search-results">{courseMatches.map((course) => <button key={course.id} onClick={() => { onAddCourse(course); setQuery('') }}><strong>{course.name}</strong><small>{course.area} · コース全体を追加</small></button>)}</div>}
      <p className="route-builder-help">地名・住所・IC・峠を入力するか、地図上の道路をタップして追加してください。住所は「静岡県伊豆市○○」のように入力できます。最初がSTART、最後がGOALになります。</p>
      <div className="route-stop-list">{route.length ? route.map((point, index) => <div key={`${point[0]}-${point[1]}-${index}`}><b>{index === 0 ? 'START' : index === route.length - 1 ? 'GOAL' : `経由 ${index}`}</b><span>{point[1].toFixed(5)}, {point[0].toFixed(5)}</span></div>) : <p>まだ地点がありません</p>}</div>
      <div className="route-builder-summary"><strong>{route.length}地点</strong><span>約 {routeDistanceKm(route).toFixed(1)} km</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="text-button" onClick={onUndo} disabled={!route.length}>1つ戻す</button><button type="button" className="text-button" onClick={onClear} disabled={!route.length}>すべて消す</button><button type="button" className="button primary" disabled={route.length < 2} onClick={() => { setError(''); setStage('details') }}>詳細へ →</button></footer>
    </div> : <form className="route-details-stage" onSubmit={submit}>
      <button type="button" className="text-button" onClick={() => setStage('route')}>← ルートを修正</button>
      <div className="form-grid">
        <label>コース名<input required name="name" placeholder="例: 伊豆スカイライン縦走" /></label><label>エリア<input required name="area" placeholder="例: 熱海峠〜天城高原" /></label>
        <label>都県<select name="prefecture"><option>東京都</option><option>神奈川県</option><option>静岡県</option></select></label><label>公開範囲<select name="visibility"><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label>
        <label className="wide">説明<textarea required name="description" rows={3} placeholder="コースの特徴やおすすめポイント" /></label><label className="wide">タグ<input name="tags" placeholder="ワイド、高原、展望" /></label><label className="wide">注意事項<textarea name="cautions" rows={2} placeholder="1行に1件。通行規制や狭路など" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '道路を確認して保存中…' : 'コースを保存'}</button></footer>
    </form>}
  </section></div>
}
