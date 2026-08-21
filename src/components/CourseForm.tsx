import { useMemo, useState, type DragEvent, type FormEvent } from 'react'
import type { Coordinate, Course, CourseDraft, DraftPointRole } from '../types'
import { routeDistanceKm } from '../lib/course'
import { buildCourseDraftDefaults, parseHashTags } from '../lib/courseDraft'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { exceedsWaypointLimit, WAYPOINT_LIMIT } from '../lib/access'
import { geocodeJapanesePlace, type GeocodedPoint } from '../lib/location'
import { generateDriveProposals, type DriveProposal, type DriveStyle } from '../lib/recommendations'
import { discoverExternalDriveProposals } from '../lib/externalDiscovery'
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
  hasProposalEditSnapshot: boolean
  onIncorporateCourse: (course: Course, insertAfter?: number | null) => void
  onFocusPoint: (point: Coordinate) => void
  onCurrentLocationChange: (point: Coordinate) => void
  onPendingPointChange: (point: Coordinate | null, label?: string) => void
  onUseProposal: (proposal: DriveProposal, placement?: 'replace' | 'append', insertAfter?: number | null) => void
  onUndoProposalEdit: () => void
  onSetProposalPreviews: (proposals: DriveProposal[]) => void
  onOpenProposalPreview: (proposalId: string) => void
  onRemovePoint: (index: number) => void
  onSetFinalPointAsGoal: () => void
  onReverseRoute: () => void
  onMoveRouteBlock: (from: number, count: number, to: number) => void
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

export function CourseForm({ transitionState = 'idle', route, pointLabels, pointRoles, viaInsertAfter, courses, canUseUnlimitedWaypoints, hasProposalEditSnapshot, onAddPoint, onIncorporateCourse, onFocusPoint, onCurrentLocationChange, onPendingPointChange, onUseProposal, onUndoProposalEdit, onSetProposalPreviews, onOpenProposalPreview, onRemovePoint, onSetFinalPointAsGoal, onReverseRoute, onMoveRouteBlock, onChooseViaInsertion, onUndo, onClear, onCancel, onSave }: Props) {
  const sheet = useMobileSheet()
  const [stage, setStage] = useState<'route' | 'details'>('route')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const [pendingSearchPoint, setPendingSearchPoint] = useState<GeocodedPoint | null>(null)
  const [details, setDetails] = useState<DetailsValues>({ name: '', area: '', prefecture: '静岡県', description: '', tags: '', cautions: '', tollStatus: 'unknown', visibility: 'public' })
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposalQuery, setProposalQuery] = useState('')
  const [proposalCenter, setProposalCenter] = useState<GeocodedPoint | null>(null)
  const [proposalRadiusKm, setProposalRadiusKm] = useState(25)
  const [proposalMaxDistanceKm, setProposalMaxDistanceKm] = useState(60)
  const [proposalStyle, setProposalStyle] = useState<DriveStyle>('balanced')
  const [proposalToll, setProposalToll] = useState<'all' | TollStatus>('all')
  const [proposalViaQuery, setProposalViaQuery] = useState('')
  const [proposalVias, setProposalVias] = useState<GeocodedPoint[]>([])
  const [proposalSettingsOpen, setProposalSettingsOpen] = useState(false)
  const [proposals, setProposals] = useState<DriveProposal[]>([])
  const [proposalError, setProposalError] = useState('')
  const [proposalProgress, setProposalProgress] = useState('')

  const [courseLibraryOpen, setCourseLibraryOpen] = useState(false)
  const [courseLibraryQuery, setCourseLibraryQuery] = useState('')
  const [draggedBlockStart, setDraggedBlockStart] = useState<number | null>(null)
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
  const incorporableCourses = useMemo(() => {
    const value = courseLibraryQuery.trim().toLocaleLowerCase('ja')
    if (!value) return courses.slice(0, 12)
    return courses.filter((course) => `${course.name}${course.area}${course.tags.join('')}`.toLocaleLowerCase('ja').includes(value)).slice(0, 12)
  }, [courseLibraryQuery, courses])
  const routeBlocks = useMemo(() => {
    const blocks: Array<{ start: number; count: number; title: string; subtitle: string }> = []
    for (let index = 0; index < route.length; index += 1) {
      const label = pointLabels[index] ?? '地図指定'
      const courseStart = label.match(/^(.*)・始点$/)
      if (courseStart) {
        const endLabel = `${courseStart[1]}・終点`
        const end = pointLabels.findIndex((item, candidate) => candidate >= index && item === endLabel)
        if (end >= index) { blocks.push({ start: index, count: end - index + 1, title: courseStart[1], subtitle: '既存コース' }); index = end; continue }
      }
      const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via')
      blocks.push({ start: index, count: 1, title: label, subtitle: role === 'start' ? '始点' : role === 'goal' ? 'ゴール' : '経由地' })
    }
    return blocks
  }, [pointLabels, pointRoles, route.length])

  function handleBlockDrop(event: DragEvent<HTMLLIElement>, target: { start: number; count: number }) {
    event.preventDefault()
    if (draggedBlockStart === null || draggedBlockStart === target.start) return
    const source = routeBlocks.find((block) => block.start === draggedBlockStart)
    if (source) onMoveRouteBlock(source.start, source.count, target.start)
    setDraggedBlockStart(null)
  }

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
    if (proposalQuery.trim() === '現在地' && proposalCenter?.label.startsWith('現在地')) {
      setProposalError('')
      onFocusPoint(proposalCenter.coordinate)
      return
    }
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
      const longitude = position.coords.longitude
      const latitude = position.coords.latitude
      const result = { coordinate: [longitude, latitude] as Coordinate, label: `現在地（${latitude.toFixed(5)}, ${longitude.toFixed(5)}）` }
      setProposalCenter(result)
      setProposalQuery('現在地')
      setProposals([])
      onCurrentLocationChange(result.coordinate)
      onFocusPoint(result.coordinate)
      onPendingPointChange(null)
      setBusy(false)
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

  async function generateProposals() {
    if (!proposalCenter) { setProposalError('まず探索するエリアを指定してください'); return }
    setBusy(true); setProposalError(''); setProposals([]); onSetProposalPreviews([]); setProposalProgress('OpenStreetMapから道路形状を取得しています…')
    const request = {
      center: proposalCenter.coordinate, radiusKm: proposalRadiusKm, maxDistanceKm: proposalMaxDistanceKm,
      toll: proposalToll, style: proposalStyle, requiredPoints: proposalVias,
    } as const
    try {
      const external = await discoverExternalDriveProposals(request)
      setProposalProgress('道路のカーブ・標高・通行条件を確認しています…')
      const catalogue = generateDriveProposals(courses, request)
      const next = [...external, ...catalogue].sort((left, right) => right.score - left.score).slice(0, 3)
      if (!next.length) { setProposalError('条件に合う道路候補が見つかりませんでした。半径・距離・料金条件を緩めてください。'); return }
      setProposals(next)
      onSetProposalPreviews(next)
    } catch (caught) {
      const fallback = generateDriveProposals(courses, request)
      if (fallback.length) { setProposals(fallback); onSetProposalPreviews(fallback); setProposalError('外部道路データの取得に失敗しました。代替候補を表示しています。') }
      else setProposalError(caught instanceof Error ? `外部道路データを取得できませんでした: ${caught.message}` : '外部道路データを取得できませんでした。時間を置いて再試行してください。')
    } finally { setBusy(false); setProposalProgress('') }
  }

  function chooseProposal(proposal: DriveProposal) {
    const append = route.length > 0
    onUseProposal(proposal, append ? 'append' : 'replace', append ? viaInsertAfter : null)
    setProposalOpen(false)
    setPendingSearchPoint(null); onPendingPointChange(null)
    setSearchNotice(append ? `「${proposal.name}」を現在のルートへ組み込みました。必要なら地点の順番を調整できます。` : `「${proposal.name}」をコースのベースにしました。地点を追加・削除して仕上げられます。`)
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
    {stage === 'route' ? <div className="route-builder-stage">
      <section className="route-builder-intro" aria-label="コースに追加する方法"><div><p className="eyebrow">ROUTE COMPOSER</p><h3>{route.length ? 'コースに追加する' : 'コースを組み立てる'}</h3></div><button type="button" className={`proposal-launch ${proposalOpen ? 'active' : ''}`} onClick={() => { setProposalOpen((value) => !value); setSearchError('') }} aria-expanded={proposalOpen} aria-controls="drive-proposal-builder">✨ 峠道を探す <span aria-hidden="true">{proposalOpen ? '−' : '+'}</span></button></section>
      {proposalOpen && <section id="drive-proposal-builder" className="drive-proposal-builder" aria-label="範囲からドライブコースを提案">
        <div><p className="eyebrow">TOUGE FINDER</p><h3>このあたりの峠道を探す</h3></div>
        <form className="route-search proposal-area-search" onSubmit={findProposalArea}><input value={proposalQuery} onChange={(event) => setProposalQuery(event.target.value)} placeholder="地名・住所・IC・峠を入力" aria-label="走りたい場所を検索" /><button disabled={busy}>{busy ? '検索中…' : 'この場所にする'}</button></form>
        <div className="proposal-current-location"><button type="button" className="text-button" onClick={useCurrentLocationForProposal}>◎ 現在地を使う</button>{proposalCenter && <strong>探索地点: {proposalCenter.label}</strong>}</div>
        <button type="button" className={`proposal-settings-toggle ${proposalSettingsOpen ? 'open' : ''}`} onClick={() => setProposalSettingsOpen((value) => !value)} aria-expanded={proposalSettingsOpen} aria-controls="proposal-settings">詳細条件 <span aria-hidden="true">{proposalSettingsOpen ? '−' : '+'}</span></button>
        <div id="proposal-settings" className={`proposal-settings ${proposalSettingsOpen ? 'open' : ''}`} aria-hidden={!proposalSettingsOpen}><div className="proposal-settings-inner">
          <div className="proposal-grid">
            <label>探索半径<select value={proposalRadiusKm} onChange={(event) => setProposalRadiusKm(Number(event.target.value))}><option value={5}>5km</option><option value={10}>10km</option><option value={25}>25km</option><option value={50}>50km</option><option value={100}>100km</option></select></label>
            <label>最大距離<select value={proposalMaxDistanceKm} onChange={(event) => setProposalMaxDistanceKm(Number(event.target.value))}><option value={20}>20km</option><option value={40}>40km</option><option value={60}>60km</option><option value={100}>100km</option><option value={200}>200km</option></select></label>
            <label>走り方<select value={proposalStyle} onChange={(event) => setProposalStyle(event.target.value as DriveStyle)}><option value="winding">ワインディング重視</option><option value="balanced">バランス</option><option value="easy">走りやすさ重視</option></select></label>
            <label>料金<select value={proposalToll} onChange={(event) => setProposalToll(event.target.value as 'all' | TollStatus)}><option value="all">指定なし</option><option value="free">無料のみ</option><option value="toll">有料道路</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select></label>
          </div>
          <div className="proposal-via"><label>必ず通りたい地点<input value={proposalViaQuery} onChange={(event) => setProposalViaQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addProposalVia() } }} placeholder="例: 大観山、三国峠" /></label><button type="button" className="button secondary" onClick={() => void addProposalVia()} disabled={busy}>追加</button></div>
          {proposalVias.length > 0 && <div className="proposal-via-tags">{proposalVias.map((point) => <span key={point.label}>{point.label}<button type="button" onClick={() => setProposalVias((items) => items.filter((item) => item.label !== point.label))} aria-label={`${point.label}を除外`}>×</button></span>)}</div>}
        </div></div>
        {proposalError && <p className="form-error" role="alert">{proposalError}</p>}
        <button type="button" className="button primary proposal-generate" onClick={generateProposals} disabled={!proposalCenter || busy}>{busy ? '道路を探索中…' : 'この条件で3案を見る'}</button>
        {proposalProgress && <div className="proposal-loading" role="status" aria-live="polite"><span aria-hidden="true" /><div><strong>道路を探索しています</strong><small>{proposalProgress}</small></div></div>}
        {proposals.length > 0 && <div className="proposal-results" aria-live="polite"><p className="proposal-map-hint">3案を地図へ一時表示中です。ラインまたは「プレビュー」で、保存前の詳細を確認できます。</p>{proposals.map((proposal, index) => <article key={proposal.id}><span>候補 {index + 1} · {proposal.source === 'openstreetmap' ? '外部道路から発見' : '登録済みコース'}</span><h4>{proposal.name}</h4><p>{proposal.area} · {proposal.distanceKm.toFixed(1)}km · {tollStatusLabels[proposal.tollStatus]}</p><ul>{proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{proposal.validation && <small className="proposal-validation">品質検証済み: 最大欠落 {proposal.validation.maxGapKm.toFixed(2)}km · {proposal.validation.elevationSource}</small>}<div className="proposal-actions"><button type="button" className="button secondary" onClick={() => onOpenProposalPreview(proposal.id)}>プレビュー</button><button type="button" className="button primary" onClick={() => chooseProposal(proposal)}>{route.length ? 'この候補をルートに追加 →' : 'この候補を使う →'}</button></div></article>)}</div>}
      </section>}
      {hasProposalEditSnapshot && proposals.length > 0 && <button type="button" className="proposal-edit-back" onClick={() => { onUndoProposalEdit(); setProposalOpen(true); setSearchNotice('候補を採用する前の状態に戻しました。別の候補を選べます。') }}>← 候補を採用する前に戻る</button>}
      <section className="existing-route-insert" aria-label="既存コースをルートへ組み込む">
        <button type="button" className="existing-route-toggle" onClick={() => setCourseLibraryOpen((value) => !value)} aria-expanded={courseLibraryOpen}>
          <span aria-hidden="true">⇄</span><strong>既存コースを組み込む</strong><small>{viaInsertAfter !== null ? '選んだ追加先の直後へ道順を追加' : '今のゴールの直前へ道順を追加'}</small><b aria-hidden="true">{courseLibraryOpen ? '−' : '+'}</b>
        </button>
        <div className={`existing-route-library ${courseLibraryOpen ? 'open' : ''}`} aria-hidden={!courseLibraryOpen}>
          <div className="existing-route-library-inner">
            <input value={courseLibraryQuery} onChange={(event) => setCourseLibraryQuery(event.target.value)} placeholder="コース名・エリア・タグで絞り込み" aria-label="組み込む既存コースを検索" />
            <p>選んだコースを現在の地点列へ追加します。追加先を選んでいる場合はその直後、それ以外はゴールの直前に組み込みます。</p>
            <div className="existing-route-results">{incorporableCourses.map((course) => <button key={course.id} type="button" onClick={() => { onIncorporateCourse(course, viaInsertAfter); setCourseLibraryOpen(false); setCourseLibraryQuery(''); setSearchNotice(`「${course.name}」をルートに組み込みました。必要なら地点の順番を調整できます。`) }}><span>＋</span><div><strong>{course.name}</strong><small>{course.area} · {course.distanceKm.toFixed(1)} km</small></div></button>)}</div>
          </div>
        </div>
      </section>
      <form className="route-search" onSubmit={addSearchedPlace}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="地名・住所・IC・峠・コースを検索" aria-label="ルートへ追加する場所または住所を検索" /><button disabled={busy}>{busy ? '検索中…' : '地点を追加'}</button></form>
      {searchError && <section className="search-not-found" role="alert"><strong>場所が見つかりませんでした</strong><p>{searchError}</p><small>地点は追加されていません。地名の一部・施設名・IC名で検索し直すか、地図をタップして正確な位置を指定してください。</small></section>}
      {pendingSearchPoint && <section className="address-match-confirm" aria-label="検索結果の確認"><strong>検索結果を確認</strong><span>{pendingSearchPoint.label}</span><small>{pendingSearchPoint.level ? `住所レベル ${pendingSearchPoint.level} の位置です。建物の入口ではなく、住所代表点の場合があります。` : '地図上の赤い仮ピンを確認してから追加してください。'}</small><div><button type="button" className="button secondary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'via', viaInsertAfter); setSearchNotice(route.length ? '経由地として追加しました。必要なら地図上のピンを長押しして調整できます。' : '始点として追加しました。次に経由地またはゴールを追加してください。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>{route.length ? '経由地として追加' : '始点として追加'}</button>{route.length > 0 && <button type="button" className="button primary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'goal'); setSearchNotice('ゴールとして追加しました。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>ゴールとして追加</button>}<button type="button" className="text-button" onClick={() => { setPendingSearchPoint(null); onPendingPointChange(null) }}>追加しない</button></div></section>}
      {courseMatches.length > 0 && <div className="route-search-results">{courseMatches.map((course) => <button key={course.id} type="button" onClick={() => { onIncorporateCourse(course, viaInsertAfter); setQuery(''); setSearchNotice(`「${course.name}」をルートに組み込みました。必要なら地点の順番を調整できます。`) }}><strong>{course.name}</strong><small>{course.area} · コース全体を組み込む</small></button>)}</div>}
      <p className="route-builder-help">最初に地点を追加すると始点になります。以降は地図上の道路や検索結果を「経由地」または「ゴール」として追加できます。既存コースも同じ地点列へ組み込めるため、地点・既存コース・地点を好きな順番でつなげられます。地点一覧の「＋」を押すと、その地点の直後を追加先に選べます。</p>
      {routeBlocks.length > 1 && <section className="route-order-editor" aria-label="ルートの順番を変更"><div><strong>ルートの順番</strong><small>ドラッグ＆ドロップで入れ替え</small></div><ol>{routeBlocks.map((block, index) => <li key={`${block.start}-${block.title}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggedBlockStart(block.start) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleBlockDrop(event, block)} onDragEnd={() => setDraggedBlockStart(null)} className={draggedBlockStart === block.start ? 'dragging' : ''}><span aria-hidden="true">⠿</span><div><strong>{block.title}</strong><small>{block.subtitle}{block.count > 1 ? ` · ${block.count}地点` : ''}</small></div><button type="button" onClick={() => { const target = routeBlocks[index - 1]; if (target) onMoveRouteBlock(block.start, block.count, target.start) }} disabled={index === 0} aria-label={`${block.title}を前へ`}>↑</button><button type="button" onClick={() => { const target = routeBlocks[index + 1]; if (target) onMoveRouteBlock(block.start, block.count, target.start + target.count) }} disabled={index === routeBlocks.length - 1} aria-label={`${block.title}を後へ`}>↓</button></li>)}</ol></section>}
      <div className="route-stop-list">{route.length ? route.map((point, index) => { const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via'); const roleText = role === 'start' ? 'START' : role === 'goal' ? 'GOAL' : `経由 ${pointRoles.slice(0, index + 1).filter((item) => item === 'via').length || index}`; return <div key={`${point[0]}-${point[1]}-${index}`}><b>{roleText}</b><span><strong>{pointLabels[index] || '地図指定'}</strong><small>{point[1].toFixed(5)}, {point[0].toFixed(5)}</small></span>{role !== 'goal' && <button type="button" className={`insert-stop ${viaInsertAfter === index ? 'active' : ''}`} onClick={() => onChooseViaInsertion(viaInsertAfter === index ? null : index)} aria-label={`${roleText}の直後に経由地を追加`}>{viaInsertAfter === index ? '追加先' : '＋'}</button>}<button type="button" onClick={() => onRemovePoint(index)} aria-label={`${roleText}を削除`}>×</button></div> }) : <p>まだ地点がありません</p>}</div>
      {route.length >= 2 && !hasGoal && <button type="button" className="set-goal-button" onClick={onSetFinalPointAsGoal}>現在の最後の地点をゴールに設定</button>}
      {route.length >= 2 && hasGoal && <button type="button" className="reverse-route-button" onClick={onReverseRoute}>⇄ 始点とゴールを入れ替える</button>}
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
