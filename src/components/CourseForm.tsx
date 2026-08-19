import { useMemo, useState, type FormEvent } from 'react'
import type { Coordinate, Course, CourseDraft, DraftPointRole } from '../types'
import { routeDistanceKm } from '../lib/course'
import { buildCourseDraftDefaults, parseHashTags } from '../lib/courseDraft'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { exceedsWaypointLimit, WAYPOINT_LIMIT } from '../lib/access'

interface Props {
  route: Coordinate[]
  canUseUnlimitedWaypoints: boolean
  pointLabels: string[]
  pointRoles: DraftPointRole[]
  viaInsertAfter: number | null
  courses: Course[]
  onAddPoint: (point: Coordinate, label?: string, role?: 'via' | 'goal', insertAfter?: number | null) => void
  onAddCourse: (course: Course) => void
  onRemovePoint: (index: number) => void
  onChooseViaInsertion: (index: number | null) => void
  onUndo: () => void
  onClear: () => void
  onCancel: () => void
  onSave: (draft: CourseDraft) => Promise<void>
}

interface GeocodedPoint { coordinate: Coordinate; label: string; level?: number }

interface DetailsValues {
  name: string
  area: string
  prefecture: CourseDraft['prefecture']
  description: string
  tags: string
  cautions: string
  visibility: CourseDraft['visibility']
}

async function geocode(query: string): Promise<GeocodedPoint> {
  const normalized = query.trim().replace(/[－ー−]/g, '-')
  const candidates = [...new Set([
    normalized,
    normalized.replace(/([0-9０-９]+)\s*-\s*([0-9０-９]+)/g, '$1番$2号'),
  ].filter(Boolean))]
  // CSIS provides Japanese residence-address-level results. Do not silently
  // degrade an address to a town-centre result: exactness matters for homes.
  const looksLikeAddress = /[0-9０-９]/.test(normalized)
  if (looksLikeAddress) {
    try {
      for (const candidate of candidates) {
        const response = await fetch(`https://geocode.csis.u-tokyo.ac.jp/cgi-bin/simple_geocode.cgi?charset=UTF8&series=ADDRESS&addr=${encodeURIComponent(candidate)}`)
        if (!response.ok) continue
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        const result = xml.querySelector('candidate')
        const longitude = Number(result?.querySelector('longitude')?.textContent)
        const latitude = Number(result?.querySelector('latitude')?.textContent)
        const level = Number(result?.querySelector('iLvl')?.textContent)
        if (Number.isFinite(longitude) && Number.isFinite(latitude) && level >= 6) return { coordinate: [longitude, latitude], label: result?.querySelector('address')?.textContent?.replaceAll('/', '') || candidate, level }
      }
    } catch { /* Continue with exact-match sources below. */ }
    throw new Error(`「${query}」の番地レベルの位置を確認できませんでした。概算位置は追加していません。地図上で正確な場所を指定してください`)
  }
  // GSI and Nominatim remain useful for named locations such as ICs and peaks.
  try {
    for (const candidate of candidates) {
      const addressResponse = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(candidate)}`)
      if (!addressResponse.ok) continue
      const result = await addressResponse.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
      const coordinates = result.features?.[0]?.geometry?.coordinates
      if (coordinates && coordinates.every(Number.isFinite)) return { coordinate: coordinates, label: candidate }
    }
  } catch { /* Continue with the named-place search below. */ }
  for (const candidate of candidates) {
    const placeQuery = /日本|東京都|神奈川県|静岡県/.test(candidate) ? candidate : `${candidate}, 日本`
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=jp&q=${encodeURIComponent(placeQuery)}`)
    if (!response.ok) continue
    const items = await response.json() as Array<{ lon: string; lat: string }>
    if (items[0]) return { coordinate: [Number(items[0].lon), Number(items[0].lat)], label: candidate }
  }
  throw new Error(`「${query}」が見つかりませんでした。地図上で正確な場所を指定してください`)
}

export function CourseForm({ route, pointLabels, pointRoles, viaInsertAfter, courses, canUseUnlimitedWaypoints, onAddPoint, onAddCourse, onRemovePoint, onChooseViaInsertion, onUndo, onClear, onCancel, onSave }: Props) {
  const sheet = useMobileSheet()
  const [stage, setStage] = useState<'route' | 'details'>('route')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const [pendingSearchPoint, setPendingSearchPoint] = useState<GeocodedPoint | null>(null)
  const [details, setDetails] = useState<DetailsValues>({ name: '', area: '', prefecture: '静岡県', description: '', tags: '', cautions: '', visibility: 'public' })
  const hasGoal = pointRoles.includes('goal')
  const courseMatches = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('ja')
    if (!value) return []
    return courses.filter((course) => `${course.name}${course.area}${course.tags.join('')}`.toLocaleLowerCase('ja').includes(value)).slice(0, 3)
  }, [courses, query])
  const recommendedTags = useMemo(() => [...courses
    .flatMap((course) => course.tags)
    .reduce((counts, tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1), new Map<string, number>())
    .entries()]
    .sort(([, left], [, right]) => right - left)
    .map(([tag]) => tag)
    .slice(0, 8), [courses])

  function openDetails() {
    const defaults = buildCourseDraftDefaults(pointLabels, route)
    setDetails({ name: defaults.name, area: defaults.area, prefecture: defaults.prefecture, description: '', tags: '', cautions: '', visibility: 'public' })
    setError('')
    setStage('details')
  }

  function addRecommendedTag(tag: string) {
    const current = parseHashTags(details.tags)
    if (current.includes(tag)) return
    setDetails((previous) => ({ ...previous, tags: [...current, tag].map((item) => `#${item}`).join(', ') }))
  }

  async function addSearchedPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSearchNotice(''); setPendingSearchPoint(null)
    if (!query.trim()) return
    setBusy(true)
    try { const result = await geocode(query.trim()); setPendingSearchPoint(result); setQuery('') } catch (caught) { setError(caught instanceof Error ? caught.message : '場所を検索できませんでした') } finally { setBusy(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (route.length < 2 || !hasGoal) { setError('地図上で始点とゴールを指定してください。'); setStage('route'); return }
    if (exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)) { setError(`地点は${WAYPOINT_LIMIT}個以下にしてください。不要な経由地を削除してから保存してください。`); setStage('route'); return }
    const defaults = buildCourseDraftDefaults(pointLabels, route)
    const draft: CourseDraft = {
      name: details.name.trim() || defaults.name, area: details.area.trim() || defaults.area, prefecture: details.prefecture, description: details.description.trim(), route,
      tags: parseHashTags(details.tags), cautions: details.cautions.split('\n').map((item) => item.trim()).filter(Boolean), visibility: details.visibility,
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

  return <div className="modal-backdrop" role="presentation"><section className={`modal course-form ${sheet.className}`} style={sheet.style} aria-label="ルートビルダー">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">ROUTE BUILDER</p><h2>コースを作る</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
    <div className="course-form-steps"><span className={stage === 'route' ? 'active' : 'done'}>1 ルート</span><b>→</b><span className={stage === 'details' ? 'active' : ''}>2 詳細・公開</span></div></div>
    {stage === 'route' ? <div className="route-builder-stage">
      <form className="route-search" onSubmit={addSearchedPlace}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="地名・住所・IC・峠・コースを検索" aria-label="ルートへ追加する場所または住所を検索" /><button disabled={busy}>{busy ? '検索中…' : '地点を追加'}</button></form>
      {pendingSearchPoint && <section className="address-match-confirm" aria-label="検索結果の確認"><strong>検索結果を確認</strong><span>{pendingSearchPoint.label}</span><small>{pendingSearchPoint.level ? `住所レベル ${pendingSearchPoint.level} の位置です。建物の入口ではなく、住所代表点の場合があります。` : '地図上の位置を確認してから追加してください。'}</small><div><button type="button" className="button secondary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'via', viaInsertAfter); setSearchNotice(route.length ? '経由地として追加しました。必要なら地図上のピンを長押しして調整できます。' : '始点として追加しました。次に経由地またはゴールを追加してください。'); setPendingSearchPoint(null) }}>{route.length ? '経由地として追加' : '始点として追加'}</button>{route.length > 0 && <button type="button" className="button primary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'goal'); setSearchNotice('ゴールとして追加しました。'); setPendingSearchPoint(null) }}>ゴールとして追加</button>}</div></section>}
      {courseMatches.length > 0 && <div className="route-search-results">{courseMatches.map((course) => <button key={course.id} onClick={() => { onAddCourse(course); setQuery('') }}><strong>{course.name}</strong><small>{course.area} · コース全体を追加</small></button>)}</div>}
      <p className="route-builder-help">最初に始点を追加し、地図上の道路をタップしたら「経由地」または「ゴール」を選びます。地点一覧の「＋」を押すと、その地点の直後を追加先に選べます。住所は番地まで入力できます（例: 静岡県伊豆の国市南條99-3）。ピンはPCではドラッグ、スマホでは長押し後のドラッグで位置を動かせます。</p>
      <div className="route-stop-list">{route.length ? route.map((point, index) => { const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via'); const roleText = role === 'start' ? 'START' : role === 'goal' ? 'GOAL' : `経由 ${pointRoles.slice(0, index + 1).filter((item) => item === 'via').length || index}`; return <div key={`${point[0]}-${point[1]}-${index}`}><b>{roleText}</b><span><strong>{pointLabels[index] || '地図指定'}</strong><small>{point[1].toFixed(5)}, {point[0].toFixed(5)}</small></span>{role !== 'goal' && <button type="button" className={`insert-stop ${viaInsertAfter === index ? 'active' : ''}`} onClick={() => onChooseViaInsertion(viaInsertAfter === index ? null : index)} aria-label={`${roleText}の直後に経由地を追加`}>{viaInsertAfter === index ? '追加先' : '＋'}</button>}<button type="button" onClick={() => onRemovePoint(index)} aria-label={`${roleText}を削除`}>×</button></div> }) : <p>まだ地点がありません</p>}</div>
      <div className="route-builder-summary"><strong className={exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints) ? 'form-error' : ''}>{canUseUnlimitedWaypoints ? `${route.length}地点` : `${route.length} / ${WAYPOINT_LIMIT}地点`}</strong><span>約 {routeDistanceKm(route).toFixed(1)} km</span></div>
      {searchNotice && <p className="form-success" role="status">{searchNotice}</p>}
      <p className="route-privacy-note">自宅などの住所を追加する場合、公開範囲は「フレンド・リンク限定」または「非公開」を推奨します。保存されるのはルート上の位置情報です。</p>
      <p className="geocoder-credit">住所検索: <a href="https://geocode.csis.u-tokyo.ac.jp/" target="_blank" rel="noreferrer">CSISシンプルジオコーディング実験</a></p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="text-button" onClick={onUndo} disabled={!route.length}>1つ戻す</button><button type="button" className="text-button" onClick={onClear} disabled={!route.length}>すべて消す</button><button type="button" className="button primary" disabled={route.length < 2 || !hasGoal || exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)} onClick={openDetails}>詳細へ →</button></footer>
    </div> : <form className="route-details-stage" onSubmit={submit}>
      <button type="button" className="text-button" onClick={() => setStage('route')}>← ルートを修正</button>
      <div className="form-grid">
        <label>コース名<input value={details.name} onChange={(event) => setDetails((previous) => ({ ...previous, name: event.target.value }))} placeholder="地点名から自動入力されます" /></label><label>エリア<input value={details.area} onChange={(event) => setDetails((previous) => ({ ...previous, area: event.target.value }))} placeholder="地点名から自動入力されます" /></label>
        <label>都県<select value={details.prefecture} onChange={(event) => setDetails((previous) => ({ ...previous, prefecture: event.target.value as CourseDraft['prefecture'] }))}><option>東京都</option><option>神奈川県</option><option>静岡県</option></select></label><label>公開範囲<select value={details.visibility} onChange={(event) => setDetails((previous) => ({ ...previous, visibility: event.target.value as CourseDraft['visibility'] }))}><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label>
        <label className="wide">説明（任意）<textarea value={details.description} onChange={(event) => setDetails((previous) => ({ ...previous, description: event.target.value }))} rows={3} placeholder="コースの特徴やおすすめポイント" /></label><label className="wide">タグ（任意）<input value={details.tags} onChange={(event) => setDetails((previous) => ({ ...previous, tags: event.target.value }))} list="course-tag-suggestions" placeholder="#ワイド, #高原, #展望" /><datalist id="course-tag-suggestions">{recommendedTags.map((tag) => <option key={tag} value={`#${tag}`} />)}</datalist><small className="tag-help">#から始まる語だけを保存します。カンマまたは空白で区切れます。</small></label>
        {recommendedTags.length > 0 && <div className="wide tag-recommendations" aria-label="おすすめのタグ"><span>おすすめ</span>{recommendedTags.map((tag) => <button key={tag} type="button" onClick={() => addRecommendedTag(tag)}>#{tag}</button>)}</div>}
        <label className="wide">注意事項（任意）<textarea value={details.cautions} onChange={(event) => setDetails((previous) => ({ ...previous, cautions: event.target.value }))} rows={2} placeholder="1行に1件。通行規制や狭路など" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '道路・標高を確認して保存中…' : 'コースを保存'}</button></footer>
    </form>}
  </section></div>
}
