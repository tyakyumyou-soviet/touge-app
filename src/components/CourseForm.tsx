import { useMemo, useState, type FormEvent } from 'react'
import type { Coordinate, Course, CourseDraft, DraftPointRole } from '../types'
import { routeDistanceKm } from '../lib/course'
import { buildCourseDraftDefaults, parseHashTags } from '../lib/courseDraft'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { exceedsWaypointLimit, WAYPOINT_LIMIT } from '../lib/access'
import { geocodeJapanesePlace, type GeocodedPoint } from '../lib/location'
import { generateDriveProposals, type DriveProposal, type DriveStyle } from '../lib/recommendations'
import { tollStatusLabels } from '../lib/toll'
import type { TollStatus } from '../types'

interface Props {
  transitionState?: 'idle' | 'entering' | 'leaving'
  route: Coordinate[]
  canUseUnlimitedWaypoints: boolean
  pointLabels: string[]
  pointRoles: DraftPointRole[]
  viaInsertAfter: number | null
  courses: Course[]
  onAddPoint: (point: Coordinate, label?: string, role?: 'via' | 'goal', insertAfter?: number | null) => void
  onAddCourse: (course: Course) => void
  onFocusPoint: (point: Coordinate) => void
  onPendingPointChange: (point: Coordinate | null, label?: string) => void
  onPreviewJoined: (courses: Course[]) => void
  onUseProposal: (proposal: DriveProposal) => void
  onCreateJoined: (courses: Course[], values: { name: string; visibility: Course['visibility'] }) => Promise<void>
  onRemovePoint: (index: number) => void
  onChooseViaInsertion: (index: number | null) => void
  onUndo: () => void
  onClear: () => void
  onCancel: () => void
  onSave: (draft: CourseDraft) => Promise<void>
}

interface DetailsValues {
  name: string
  area: string
  prefecture: CourseDraft['prefecture']
  description: string
  tags: string
  cautions: string
  tollStatus: TollStatus
  visibility: CourseDraft['visibility']
}

export function CourseForm({ transitionState = 'idle', route, pointLabels, pointRoles, viaInsertAfter, courses, canUseUnlimitedWaypoints, onAddPoint, onAddCourse, onFocusPoint, onPendingPointChange, onPreviewJoined, onUseProposal, onCreateJoined, onRemovePoint, onChooseViaInsertion, onUndo, onClear, onCancel, onSave }: Props) {
  const sheet = useMobileSheet()
  const [stage, setStage] = useState<'choice' | 'route' | 'details' | 'join' | 'join-details'>('choice')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const [pendingSearchPoint, setPendingSearchPoint] = useState<GeocodedPoint | null>(null)
  const [details, setDetails] = useState<DetailsValues>({ name: '', area: '', prefecture: '静岡県', description: '', tags: '', cautions: '', tollStatus: 'unknown', visibility: 'public' })
  const [routeMode, setRouteMode] = useState<'manual' | 'suggest'>('manual')
  const [proposalQuery, setProposalQuery] = useState('')
  const [proposalCenter, setProposalCenter] = useState<GeocodedPoint | null>(null)
  const [proposalRadiusKm, setProposalRadiusKm] = useState(25)
  const [proposalMaxDistanceKm, setProposalMaxDistanceKm] = useState(60)
  const [proposalStyle, setProposalStyle] = useState<DriveStyle>('balanced')
  const [proposalToll, setProposalToll] = useState<'all' | TollStatus>('all')
  const [proposalViaQuery, setProposalViaQuery] = useState('')
  const [proposalVias, setProposalVias] = useState<GeocodedPoint[]>([])
  const [proposals, setProposals] = useState<DriveProposal[]>([])
  const [proposalError, setProposalError] = useState('')
  const [joinedIds, setJoinedIds] = useState<string[]>([])
  const [joinedName, setJoinedName] = useState('')
  const [joinedVisibility, setJoinedVisibility] = useState<Course['visibility']>('limited')
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
  const joinedCourses = useMemo(() => joinedIds.map((id) => courses.find((course) => course.id === id)).filter((course): course is Course => Boolean(course)), [courses, joinedIds])

  function openDetails() {
    const defaults = buildCourseDraftDefaults(pointLabels, route)
    setDetails({ name: defaults.name, area: defaults.area, prefecture: defaults.prefecture, description: '', tags: '', cautions: '', tollStatus: 'unknown', visibility: 'public' })
    setError('')
    setStage('details')
  }

  function addRecommendedTag(tag: string) {
    const current = parseHashTags(details.tags)
    if (current.includes(tag)) return
    setDetails((previous) => ({ ...previous, tags: [...current, tag].map((item) => `#${item}`).join(', ') }))
  }

  function chooseJoinedCourse(course: Course) {
    const nextIds = joinedIds.includes(course.id) ? joinedIds.filter((id) => id !== course.id) : [...joinedIds, course.id]
    setJoinedIds(nextIds)
    onPreviewJoined(nextIds.map((id) => courses.find((item) => item.id === id)).filter((item): item is Course => Boolean(item)))
  }

  function moveJoinedCourse(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= joinedIds.length) return
    const nextIds = [...joinedIds]
    ;[nextIds[index], nextIds[target]] = [nextIds[target], nextIds[index]]
    setJoinedIds(nextIds)
    onPreviewJoined(nextIds.map((id) => courses.find((item) => item.id === id)).filter((item): item is Course => Boolean(item)))
  }

  function leaveJoinBuilder() {
    setJoinedIds([])
    onPreviewJoined([])
    setStage('choice')
  }

  function openJoinedDetails() {
    if (joinedCourses.length < 2) return
    setJoinedName(`${joinedCourses.map((course) => course.name).join(' ＋ ')}（連結）`)
    setStage('join-details')
  }

  async function saveJoinedCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (joinedCourses.length < 2) return
    setBusy(true); setError('')
    try { await onCreateJoined(joinedCourses, { name: joinedName.trim() || `${joinedCourses.map((course) => course.name).join(' ＋ ')}（連結）`, visibility: joinedVisibility }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '連結コースを保存できませんでした') }
    finally { setBusy(false) }
  }

  async function addSearchedPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setSearchError(''); setSearchNotice(''); setPendingSearchPoint(null); onPendingPointChange(null)
    if (!query.trim()) return
    setBusy(true)
    try {
      const result = await geocodeJapanesePlace(query.trim())
      setPendingSearchPoint(result)
      onFocusPoint(result.coordinate)
      onPendingPointChange(result.coordinate, result.label)
      setQuery('')
    } catch (caught) { setSearchError(caught instanceof Error ? caught.message : '場所を検索できませんでした') } finally { setBusy(false) }
  }

  async function findProposalArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!proposalQuery.trim()) return
    setBusy(true); setProposalError(''); setProposals([])
    try {
      const result = await geocodeJapanesePlace(proposalQuery)
      setProposalCenter(result)
      onFocusPoint(result.coordinate)
      onPendingPointChange(result.coordinate, result.label)
    } catch (caught) { setProposalError(caught instanceof Error ? caught.message : '探索エリアを検索できませんでした') }
    finally { setBusy(false) }
  }

  function useCurrentLocationForProposal() {
    if (!navigator.geolocation) { setProposalError('この端末では現在地を取得できません'); return }
    setBusy(true); setProposalError('')
    navigator.geolocation.getCurrentPosition((position) => {
      const result = { coordinate: [position.coords.longitude, position.coords.latitude] as Coordinate, label: '現在地' }
      setProposalCenter(result); onFocusPoint(result.coordinate); onPendingPointChange(result.coordinate, result.label); setBusy(false)
    }, () => { setProposalError('現在地を取得できませんでした。位置情報の許可を確認してください。'); setBusy(false) }, { enableHighAccuracy: true, timeout: 10000 })
  }

  async function addProposalVia() {
    if (!proposalViaQuery.trim()) return
    setBusy(true); setProposalError('')
    try {
      const result = await geocodeJapanesePlace(proposalViaQuery)
      setProposalVias((items) => items.some((item) => item.label === result.label) ? items : [...items, result])
      setProposalViaQuery('')
      onFocusPoint(result.coordinate)
      onPendingPointChange(result.coordinate, result.label)
    } catch (caught) { setProposalError(caught instanceof Error ? caught.message : '経由地を検索できませんでした') }
    finally { setBusy(false) }
  }

  function generateProposals() {
    if (!proposalCenter) { setProposalError('まず探索するエリアを指定してください'); return }
    const next = generateDriveProposals(courses, {
      center: proposalCenter.coordinate, radiusKm: proposalRadiusKm, maxDistanceKm: proposalMaxDistanceKm,
      toll: proposalToll, style: proposalStyle, requiredPoints: proposalVias,
    })
    if (!next.length) { setProposalError('条件に合う提案が見つかりませんでした。半径・距離・料金条件を緩めてください。'); return }
    setProposalError(''); setProposals(next)
  }

  function chooseProposal(proposal: DriveProposal) {
    onUseProposal(proposal)
    setRouteMode('manual')
    setProposals([])
    setPendingSearchPoint(null); onPendingPointChange(null)
    setSearchNotice(`「${proposal.name}」を提案ルートとして読み込みました。地点を追加・削除して仕上げられます。`)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (route.length < 2 || !hasGoal) { setError('地図上で始点とゴールを指定してください。'); setStage('route'); return }
    if (exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)) { setError(`地点は${WAYPOINT_LIMIT}個以下にしてください。不要な経由地を削除してから保存してください。`); setStage('route'); return }
    const defaults = buildCourseDraftDefaults(pointLabels, route)
    const draft: CourseDraft = {
      name: details.name.trim() || defaults.name, area: details.area.trim() || defaults.area, prefecture: details.prefecture, description: details.description.trim(), route,
      tags: parseHashTags(details.tags), cautions: details.cautions.split('\n').map((item) => item.trim()).filter(Boolean), tollStatus: details.tollStatus, visibility: details.visibility,
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

  return <div className="modal-backdrop" role="presentation"><section data-map-occlusion="bottom-sheet" className={`modal course-form ${sheet.className} surface-${transitionState}`} style={sheet.style} aria-label="ルートビルダー">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">ROUTE BUILDER</p><h2>コースを作る</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
    </div>
    {stage === 'choice' ? <section className="creation-choice" aria-label="コースの作成方法">
      <button type="button" className="creation-choice-card" onClick={() => { onPreviewJoined([]); setStage('route') }}><span aria-hidden="true">⌖</span><div><strong>地点から作る</strong><small>地名・住所・地図タップで、自由に経由地を組み立てる</small></div><b>→</b></button>
      <button type="button" className="creation-choice-card" onClick={() => { setJoinedIds([]); onPreviewJoined([]); setStage('join') }}><span aria-hidden="true">⇄</span><div><strong>既存コースを連結</strong><small>選んだコースを並べて、ひとつのオリジナルコースにする</small></div><b>→</b></button>
    </section> : stage === 'join' ? <section className="join-builder" aria-label="既存コースを連結">
      <button type="button" className="text-button" onClick={leaveJoinBuilder}>← 作成方法を選び直す</button>
      <h3>コースをつなぐ</h3><p>地図には、下の順番で選んだ区間だけを表示します。走る順番に追加してください。</p>
      <ol className="join-sequence">{joinedCourses.length ? joinedCourses.map((course, index) => <li key={course.id}><span>{index + 1}</span><strong>{course.name}</strong><div><button type="button" onClick={() => moveJoinedCourse(index, -1)} disabled={index === 0} aria-label={`${course.name}を前へ`}>↑</button><button type="button" onClick={() => moveJoinedCourse(index, 1)} disabled={index === joinedCourses.length - 1} aria-label={`${course.name}を後へ`}>↓</button><button type="button" onClick={() => chooseJoinedCourse(course)} aria-label={`${course.name}を外す`}>×</button></div></li>) : <li className="empty">下の候補から、最初のコースを選んでください。</li>}</ol>
      <div className="join-course-picker">{courses.map((course) => <button key={course.id} type="button" className={joinedIds.includes(course.id) ? 'selected' : ''} onClick={() => chooseJoinedCourse(course)}><span>{joinedIds.includes(course.id) ? `${joinedIds.indexOf(course.id) + 1}` : '+'}</span><div><strong>{course.name}</strong><small>{course.area} · {course.distanceKm.toFixed(1)} km</small></div></button>)}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={leaveJoinBuilder}>戻る</button><button type="button" className="button primary" disabled={joinedCourses.length < 2} onClick={openJoinedDetails}>ルートを確認 →</button></footer>
    </section> : stage === 'join-details' ? <form className="route-details-stage" onSubmit={saveJoinedCourse}>
      <button type="button" className="text-button" onClick={() => setStage('join')}>← 連結順を修正</button>
      <h3>連結コースの詳細</h3><p className="route-builder-help">{joinedCourses.map((course) => course.name).join(' → ')}</p>
      <div className="form-grid"><label className="wide">コース名<input value={joinedName} onChange={(event) => setJoinedName(event.target.value)} /></label><label className="wide">公開範囲<select value={joinedVisibility} onChange={(event) => setJoinedVisibility(event.target.value as Course['visibility'])}><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={() => setStage('join')}>戻る</button><button className="button primary" disabled={busy}>{busy ? '道路・標高を確認して保存中…' : '連結コースを保存'}</button></footer>
    </form> : stage === 'route' ? <div className="route-builder-stage">
      <div className="route-mode-switch" role="tablist" aria-label="地点から作る方法">
        <button type="button" role="tab" aria-selected={routeMode === 'manual'} className={routeMode === 'manual' ? 'active' : ''} onClick={() => setRouteMode('manual')}>地点を指定</button>
        <button type="button" role="tab" aria-selected={routeMode === 'suggest'} className={routeMode === 'suggest' ? 'active' : ''} onClick={() => { setRouteMode('suggest'); setSearchError('') }}>範囲から提案</button>
      </div>
      {routeMode === 'suggest' ? <section className="drive-proposal-builder" aria-label="範囲からドライブコースを提案">
        <div><p className="eyebrow">SMART DRIVE FINDER</p><h3>範囲から峠道を提案</h3><p>エリア、走り方、料金、通りたい地点を指定すると、登録済みの道路形状・評価情報から候補を比較できます。選んだ後は通常どおり地点を編集できます。</p></div>
        <form className="route-search" onSubmit={findProposalArea}><input value={proposalQuery} onChange={(event) => setProposalQuery(event.target.value)} placeholder="探索エリア（地名・住所・IC）" aria-label="探索エリアを検索" /><button disabled={busy}>{busy ? '検索中…' : 'エリアを指定'}</button></form>
        <div className="proposal-current-location"><button type="button" className="text-button" onClick={useCurrentLocationForProposal}>◎ 現在地を探索中心にする</button>{proposalCenter && <strong>中心: {proposalCenter.label}</strong>}</div>
        <div className="proposal-grid">
          <label>探索半径<select value={proposalRadiusKm} onChange={(event) => setProposalRadiusKm(Number(event.target.value))}><option value={5}>5km</option><option value={10}>10km</option><option value={25}>25km</option><option value={50}>50km</option><option value={100}>100km</option></select></label>
          <label>最大距離<select value={proposalMaxDistanceKm} onChange={(event) => setProposalMaxDistanceKm(Number(event.target.value))}><option value={20}>20km</option><option value={40}>40km</option><option value={60}>60km</option><option value={100}>100km</option><option value={200}>200km</option></select></label>
          <label>走り方<select value={proposalStyle} onChange={(event) => setProposalStyle(event.target.value as DriveStyle)}><option value="winding">ワインディング重視</option><option value="balanced">バランス</option><option value="easy">走りやすさ重視</option></select></label>
          <label>料金<select value={proposalToll} onChange={(event) => setProposalToll(event.target.value as 'all' | TollStatus)}><option value="all">指定なし</option><option value="free">無料のみ</option><option value="toll">有料道路</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select></label>
        </div>
        <div className="proposal-via"><label>必ず通りたい地点<input value={proposalViaQuery} onChange={(event) => setProposalViaQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addProposalVia() } }} placeholder="例: 大観山、三国峠" /></label><button type="button" className="button secondary" onClick={() => void addProposalVia()} disabled={busy}>追加</button></div>
        {proposalVias.length > 0 && <div className="proposal-via-tags">{proposalVias.map((point) => <span key={point.label}>{point.label}<button type="button" onClick={() => setProposalVias((items) => items.filter((item) => item.label !== point.label))} aria-label={`${point.label}を除外`}>×</button></span>)}</div>}
        {proposalError && <p className="form-error" role="alert">{proposalError}</p>}
        <button type="button" className="button primary proposal-generate" onClick={generateProposals} disabled={!proposalCenter || busy}>条件から3案を提案</button>
        {proposals.length > 0 && <div className="proposal-results" aria-live="polite">{proposals.map((proposal, index) => <article key={proposal.id}><span>候補 {index + 1}</span><h4>{proposal.name}</h4><p>{proposal.area} · {proposal.distanceKm.toFixed(1)}km · {tollStatusLabels[proposal.tollStatus]}</p><ul>{proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><button type="button" className="button secondary" onClick={() => chooseProposal(proposal)}>この候補を編集する →</button></article>)}</div>}
      </section> : <>
      <form className="route-search" onSubmit={addSearchedPlace}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="地名・住所・IC・峠・コースを検索" aria-label="ルートへ追加する場所または住所を検索" /><button disabled={busy}>{busy ? '検索中…' : '地点を追加'}</button></form>
      {searchError && <section className="search-not-found" role="alert"><strong>場所が見つかりませんでした</strong><p>{searchError}</p><small>地点は追加されていません。地名の一部・施設名・IC名で検索し直すか、地図をタップして正確な位置を指定してください。</small></section>}
      {pendingSearchPoint && <section className="address-match-confirm" aria-label="検索結果の確認"><strong>検索結果を確認</strong><span>{pendingSearchPoint.label}</span><small>{pendingSearchPoint.level ? `住所レベル ${pendingSearchPoint.level} の位置です。建物の入口ではなく、住所代表点の場合があります。` : '地図上の赤い仮ピンを確認してから追加してください。'}</small><div><button type="button" className="button secondary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'via', viaInsertAfter); setSearchNotice(route.length ? '経由地として追加しました。必要なら地図上のピンを長押しして調整できます。' : '始点として追加しました。次に経由地またはゴールを追加してください。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>{route.length ? '経由地として追加' : '始点として追加'}</button>{route.length > 0 && <button type="button" className="button primary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'goal'); setSearchNotice('ゴールとして追加しました。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>ゴールとして追加</button>}<button type="button" className="text-button" onClick={() => { setPendingSearchPoint(null); onPendingPointChange(null) }}>追加しない</button></div></section>}
      {courseMatches.length > 0 && <div className="route-search-results">{courseMatches.map((course) => <button key={course.id} onClick={() => { onAddCourse(course); setQuery('') }}><strong>{course.name}</strong><small>{course.area} · コース全体を追加</small></button>)}</div>}
      <p className="route-builder-help">最初に始点を追加し、地図上の道路をタップしたら「経由地」または「ゴール」を選びます。地点一覧の「＋」を押すと、その地点の直後を追加先に選べます。住所は番地まで入力できます（例: 静岡県伊豆の国市南條99-3）。ピンはPCではドラッグ、スマホでは長押し後のドラッグで位置を動かせます。</p>
      <div className="route-stop-list">{route.length ? route.map((point, index) => { const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via'); const roleText = role === 'start' ? 'START' : role === 'goal' ? 'GOAL' : `経由 ${pointRoles.slice(0, index + 1).filter((item) => item === 'via').length || index}`; return <div key={`${point[0]}-${point[1]}-${index}`}><b>{roleText}</b><span><strong>{pointLabels[index] || '地図指定'}</strong><small>{point[1].toFixed(5)}, {point[0].toFixed(5)}</small></span>{role !== 'goal' && <button type="button" className={`insert-stop ${viaInsertAfter === index ? 'active' : ''}`} onClick={() => onChooseViaInsertion(viaInsertAfter === index ? null : index)} aria-label={`${roleText}の直後に経由地を追加`}>{viaInsertAfter === index ? '追加先' : '＋'}</button>}<button type="button" onClick={() => onRemovePoint(index)} aria-label={`${roleText}を削除`}>×</button></div> }) : <p>まだ地点がありません</p>}</div>
      <div className="route-builder-summary"><strong className={exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints) ? 'form-error' : ''}>{canUseUnlimitedWaypoints ? `${route.length}地点` : `${route.length} / ${WAYPOINT_LIMIT}地点`}</strong><span>約 {routeDistanceKm(route).toFixed(1)} km</span></div>
      {searchNotice && <p className="form-success" role="status">{searchNotice}</p>}
      <p className="route-privacy-note">自宅などの住所を追加する場合、公開範囲は「フレンド・リンク限定」または「非公開」を推奨します。保存されるのはルート上の位置情報です。</p>
      <p className="geocoder-credit">住所検索: <a href="https://geocode.csis.u-tokyo.ac.jp/" target="_blank" rel="noreferrer">CSISシンプルジオコーディング実験</a></p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="text-button" onClick={onUndo} disabled={!route.length}>1つ戻す</button><button type="button" className="text-button" onClick={onClear} disabled={!route.length}>すべて消す</button><button type="button" className="button primary" disabled={route.length < 2 || !hasGoal || exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)} onClick={openDetails}>詳細へ →</button></footer>
      </>}
    </div> : <form className="route-details-stage" onSubmit={submit}>
      <button type="button" className="text-button" onClick={() => setStage('route')}>← ルートを修正</button>
      <div className="form-grid">
        <label>コース名<input value={details.name} onChange={(event) => setDetails((previous) => ({ ...previous, name: event.target.value }))} placeholder="地点名から自動入力されます" /></label><label>エリア<input value={details.area} onChange={(event) => setDetails((previous) => ({ ...previous, area: event.target.value }))} placeholder="地点名から自動入力されます" /></label>
        <label>都県<select value={details.prefecture} onChange={(event) => setDetails((previous) => ({ ...previous, prefecture: event.target.value as CourseDraft['prefecture'] }))}><option>東京都</option><option>神奈川県</option><option>静岡県</option></select></label><label>公開範囲<select value={details.visibility} onChange={(event) => setDetails((previous) => ({ ...previous, visibility: event.target.value as CourseDraft['visibility'] }))}><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label>
        <label className="wide">料金区分<select value={details.tollStatus} onChange={(event) => setDetails((previous) => ({ ...previous, tollStatus: event.target.value as TollStatus }))}><option value="unknown">料金情報未確認</option><option value="free">無料</option><option value="toll">有料</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select><small className="tag-help">不明な場合は「料金情報未確認」のまま保存します。無料と推測して登録しません。</small></label>
        <label className="wide">説明（任意）<textarea value={details.description} onChange={(event) => setDetails((previous) => ({ ...previous, description: event.target.value }))} rows={3} placeholder="コースの特徴やおすすめポイント" /></label><label className="wide">タグ（任意）<input value={details.tags} onChange={(event) => setDetails((previous) => ({ ...previous, tags: event.target.value }))} list="course-tag-suggestions" placeholder="#ワイド, #高原, #展望" /><datalist id="course-tag-suggestions">{recommendedTags.map((tag) => <option key={tag} value={`#${tag}`} />)}</datalist><small className="tag-help">#から始まる語だけを保存します。カンマまたは空白で区切れます。</small></label>
        {recommendedTags.length > 0 && <div className="wide tag-recommendations" aria-label="おすすめのタグ"><span>おすすめ</span>{recommendedTags.map((tag) => <button key={tag} type="button" onClick={() => addRecommendedTag(tag)}>#{tag}</button>)}</div>}
        <label className="wide">注意事項（任意）<textarea value={details.cautions} onChange={(event) => setDetails((previous) => ({ ...previous, cautions: event.target.value }))} rows={2} placeholder="1行に1件。通行規制や狭路など" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '道路・標高を確認して保存中…' : 'コースを保存'}</button></footer>
    </form>}
  </section></div>
}
