import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { RouteOrderEditor, type RouteOrderBlock } from './RouteOrderEditor'
import type { Coordinate, Course, CourseDraft, DraftPointRole, RecommendationMapAction, RecommendationMapState, UserProfile } from '../types'
import { routeDistanceKm } from '../lib/course'
import { buildCourseDraftDefaults, parseHashTags } from '../lib/courseDraft'
import { useMobileSheet } from '../hooks/useMobileSheet'
import { exceedsWaypointLimit, WAYPOINT_LIMIT } from '../lib/access'
import { geocodeJapanesePlace, resolveRouteAdministrativeAreas, type GeocodedPoint } from '../lib/location'
import { JAPANESE_PREFECTURES } from '../lib/administrativeAreas'
import { currentSearchLocation } from '../lib/currentLocation'
import { buildDriveProposalRequest, type DriveProposal, type DriveStyle } from '../lib/recommendations'
import { discoverExternalDriveProposals, RoadDiscoveryUnavailableError } from '../lib/externalDiscovery'
import { tollStatusLabels } from '../lib/toll'
import type { TollStatus } from '../types'
import { auth } from '../lib/firebase'

interface Props {
  transitionState?: 'idle' | 'entering' | 'leaving'
  previewActive?: boolean
  editingCourse?: Course | null
  route: Coordinate[]
  canUseUnlimitedWaypoints: boolean
  pointLabels: string[]
  pointRoles: DraftPointRole[]
  viaInsertAfter: number | null
  courses: Course[]
  profile?: UserProfile | null
  onAddPoint: (point: Coordinate, label?: string, role?: 'via' | 'goal', insertAfter?: number | null) => void
  hasProposalEditSnapshot: boolean
  onIncorporateCourse: (course: Course, insertAfter?: number | null) => void
  onFocusPoint: (point: Coordinate) => void
  onCurrentLocationChange: (point: Coordinate) => void
  onPendingPointChange: (point: Coordinate | null, label?: string) => void
  recommendationMapAction?: RecommendationMapAction | null
  onRecommendationMapStateChange: (state: RecommendationMapState) => void
  onUseProposal: (proposal: DriveProposal, placement?: 'replace' | 'append', insertAfter?: number | null) => void
  onUndoProposalEdit: () => void
  onSetProposalPreviews: (proposals: DriveProposal[]) => void
  onOpenProposalPreview: (proposalId: string) => void
  onRemovePoint: (index: number) => void
  onSetFinalPointAsGoal: () => void
  onReverseRoute: () => void
  onMoveRouteBlock: (from: number, count: number, to: number) => void
  onReverseRouteBlock: (start: number, count: number) => void
  onChooseViaInsertion: (index: number | null) => void
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
  allowedViewerIds: string[]
  blockedViewerIds: string[]
}

function editorStopsForSave(route: Coordinate[], labels: string[], roles: DraftPointRole[]) {
  let activeCourseName: string | null = null
  return route.map((coordinate, index) => {
    const label = labels[index] || '地図指定'
    // Incorporated courses use the stable labels created by the composer:
    // 「コース名・始点 / 経由地 / 終点」. Store the source separately so a
    // later edit never has to guess whether this was a map point or a course.
    const courseStart = label.match(/^(.*)・始点$/)
    if (courseStart) activeCourseName = courseStart[1]
    const sourceCourseName = activeCourseName && label.startsWith(`${activeCourseName}・`) ? activeCourseName : undefined
    const courseEnd = sourceCourseName && label === `${sourceCourseName}・終点`
    const stop = {
      coordinate,
      label,
      role: roles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via'),
      kind: sourceCourseName ? 'course' as const : 'point' as const,
      sourceCourseName,
    }
    if (courseEnd) activeCourseName = null
    return stop
  })
}

export function CourseForm({ transitionState = 'idle', previewActive = false, editingCourse = null, route, pointLabels, pointRoles, viaInsertAfter, courses, profile, canUseUnlimitedWaypoints, hasProposalEditSnapshot, onAddPoint, onIncorporateCourse, onFocusPoint, onCurrentLocationChange, onPendingPointChange, recommendationMapAction, onRecommendationMapStateChange, onUseProposal, onUndoProposalEdit, onSetProposalPreviews, onOpenProposalPreview, onRemovePoint, onSetFinalPointAsGoal, onReverseRoute, onMoveRouteBlock, onReverseRouteBlock, onChooseViaInsertion, onCancel, onSave }: Props) {
  const sheet = useMobileSheet()
  const effectiveProfile = useMemo(() => {
    if (profile) return profile
    const uid = auth.currentUser?.uid
    if (!uid) return null
    try { return JSON.parse(localStorage.getItem(`touge-profile-${uid}`) ?? 'null') as UserProfile | null } catch { return null }
  }, [profile])
  const [stage, setStage] = useState<'route' | 'details'>('route')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const [pendingSearchPoint, setPendingSearchPoint] = useState<GeocodedPoint | null>(null)
  const [details, setDetails] = useState<DetailsValues>({ name: '', area: '', prefecture: '静岡県', description: '', tags: '', cautions: '', tollStatus: 'unknown', visibility: 'public', allowedViewerIds: [], blockedViewerIds: [] })
  const [administrativeLookup, setAdministrativeLookup] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposalQuery, setProposalQuery] = useState('')
  const [proposalCenter, setProposalCenter] = useState<GeocodedPoint | null>(null)
  const [proposalRadiusKm, setProposalRadiusKm] = useState(25)
  const [proposalMaxDistanceKm, setProposalMaxDistanceKm] = useState(10)
  const [proposalCount, setProposalCount] = useState(1)
  const [proposalStyle, setProposalStyle] = useState<DriveStyle>('balanced')
  const [proposalToll, setProposalToll] = useState<'all' | TollStatus>('all')
  const [proposalViaQuery, setProposalViaQuery] = useState('')
  const [proposalVias, setProposalVias] = useState<GeocodedPoint[]>([])
  const [proposalStartQuery, setProposalStartQuery] = useState('')
  const [proposalGoalQuery, setProposalGoalQuery] = useState('')
  const [proposalStart, setProposalStart] = useState<GeocodedPoint | null>(null)
  const [proposalGoal, setProposalGoal] = useState<GeocodedPoint | null>(null)
  const [proposalSettingsOpen, setProposalSettingsOpen] = useState(false)
  const [proposals, setProposals] = useState<DriveProposal[]>([])
  const [proposalError, setProposalError] = useState('')
  const [proposalProgress, setProposalProgress] = useState('')
  const [proposalLocating, setProposalLocating] = useState(false)
  const [addingCurrentLocation, setAddingCurrentLocation] = useState(false)
  const proposalSearchTimer = useRef<number | null>(null)
  const proposalSearchRevision = useRef(0)
  const proposalGenerationRevision = useRef(0)
  // Begin at zero so an action dispatched while this form is mounting is not
  // mistaken for an already-consumed map action.
  const handledRecommendationAction = useRef(0)

  useEffect(() => {
    onRecommendationMapStateChange({ active: proposalOpen && stage === 'route' && !previewActive, center: proposalCenter, start: proposalStart, goal: proposalGoal, vias: proposalVias })
  }, [onRecommendationMapStateChange, previewActive, stage, proposalCenter, proposalGoal, proposalOpen, proposalStart, proposalVias])

  useEffect(() => () => {
    if (proposalSearchTimer.current !== null) window.clearTimeout(proposalSearchTimer.current)
    proposalSearchRevision.current += 1
    proposalGenerationRevision.current += 1
  }, [])

  useEffect(() => {
    if (!recommendationMapAction || recommendationMapAction.id === handledRecommendationAction.current) return
    handledRecommendationAction.current = recommendationMapAction.id
    const point = { coordinate: recommendationMapAction.point, label: '地図指定' }
    if (recommendationMapAction.action === 'center') {
      setStage('route')
      setProposalOpen(true)
      setProposalCenter(point)
      setProposalQuery('')
      setProposalError('')
      setProposals([])
      onSetProposalPreviews([])
      onFocusPoint(point.coordinate)
    }
    if (recommendationMapAction.action === 'start') setProposalStart(point)
    if (recommendationMapAction.action === 'goal') setProposalGoal(point)
    if (recommendationMapAction.action === 'via') setProposalVias((items) => [...items, point])
    if (recommendationMapAction.action === 'remove') {
      if (recommendationMapAction.role === 'start') setProposalStart(null)
      else if (recommendationMapAction.role === 'goal') setProposalGoal(null)
      else if (recommendationMapAction.role === 'via') setProposalVias((items) => items.filter((_, index) => index !== recommendationMapAction.index))
    }
  }, [onFocusPoint, onSetProposalPreviews, recommendationMapAction])

  const [courseLibraryOpen, setCourseLibraryOpen] = useState(false)
  const [courseLibraryQuery, setCourseLibraryQuery] = useState('')
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
    const blocks: RouteOrderBlock[] = []
    const occurrences = new Map<string, number>()
    for (let index = 0; index < route.length; index += 1) {
      const label = pointLabels[index] ?? '地図指定'
      const identity = `${route[index].join(',')}:${label}`
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      const id = `${identity}:${occurrence}`
      const courseStart = label.match(/^(.*)・始点$/)
      if (courseStart) {
        const endLabel = `${courseStart[1]}・終点`
        let end = index
        while (end + 1 < route.length && pointLabels[end] !== endLabel
          && pointLabels[end + 1]?.startsWith(`${courseStart[1]}・`) && !pointLabels[end + 1]?.endsWith('・始点')) end += 1
        blocks.push({ id, start: index, count: end - index + 1, title: courseStart[1], subtitle: 'コース区間' }); index = end; continue
      }
      const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via')
      blocks.push({ id, start: index, count: 1, title: label, subtitle: role === 'start' ? '始点' : role === 'goal' ? 'ゴール' : '経由地' })
    }
    return blocks
  }, [pointLabels, pointRoles, route])

  async function enrichAdministrativeAreas(defaults: Pick<DetailsValues, 'area' | 'prefecture'>) {
    setAdministrativeLookup('loading')
    try {
      const detected = await resolveRouteAdministrativeAreas(route)
      if (!detected) {
        setAdministrativeLookup('failed')
        return
      }
      setDetails((current) => ({
        ...current,
        // Do not overwrite a name the driver has already adjusted manually.
        area: current.area === defaults.area ? detected.area : current.area,
        prefecture: current.prefecture === defaults.prefecture || current.prefecture === '都道府県未判定' ? detected.prefecture : current.prefecture,
      }))
      setAdministrativeLookup('idle')
    } catch {
      setAdministrativeLookup('failed')
    }
  }

  function openDetails() {
    const defaults = buildCourseDraftDefaults(pointLabels)
    const values: DetailsValues = editingCourse ? {
      name: editingCourse.name, area: editingCourse.area, prefecture: editingCourse.prefecture,
      description: editingCourse.description, tags: editingCourse.tags.map((tag) => `#${tag}`).join(', '), cautions: editingCourse.cautions.join('\n'),
      tollStatus: editingCourse.tollStatus ?? 'unknown', visibility: editingCourse.visibility,
      allowedViewerIds: editingCourse.allowedViewerIds ?? [], blockedViewerIds: [],
    } : { name: defaults.name, area: defaults.area, prefecture: defaults.prefecture, description: '', tags: '', cautions: '', tollStatus: 'unknown', visibility: 'public', allowedViewerIds: [], blockedViewerIds: [] }
    setDetails(values)
    setError('')
    setStage('details')
    if (!editingCourse) void enrichAdministrativeAreas(defaults)
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

  async function addCurrentLocation() {
    if (busy || addingCurrentLocation) return
    setError(''); setSearchError(''); setSearchNotice(''); setPendingSearchPoint(null); onPendingPointChange(null)
    setAddingCurrentLocation(true)
    try {
      const result = await currentSearchLocation()
      setPendingSearchPoint(result)
      onCurrentLocationChange(result.coordinate)
      onFocusPoint(result.coordinate)
      onPendingPointChange(result.coordinate, result.label)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '現在地を取得できませんでした'
      setSearchError(message.startsWith('現在地') || message.startsWith('この端末') ? message : `現在地を取得できませんでした: ${message}`)
    } finally { setAddingCurrentLocation(false) }
  }

  async function resolveProposalArea(value: string, revision = proposalSearchRevision.current) {
    if (!value.trim()) return
    if (value.trim() === '現在地' && proposalCenter?.label.startsWith('現在地')) {
      setProposalError('')
      onFocusPoint(proposalCenter.coordinate)
      return
    }
    proposalGenerationRevision.current += 1
    setProposalProgress('')
    setBusy(true); setProposalError(''); setProposals([]); onSetProposalPreviews([])
    try {
      const result = await geocodeJapanesePlace(value)
      if (revision !== proposalSearchRevision.current) return
      setProposalCenter(result)
      onFocusPoint(result.coordinate)
      // An area search is not a request to add a builder stop.
      onPendingPointChange(null)
    } catch (caught) {
      if (revision === proposalSearchRevision.current) setProposalError(caught instanceof Error ? caught.message : '探索エリアを検索できませんでした')
    } finally {
      if (revision === proposalSearchRevision.current) setBusy(false)
    }
  }

  function findProposalArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (proposalLocating || !proposalQuery.trim()) return
    if (proposalSearchTimer.current !== null) window.clearTimeout(proposalSearchTimer.current)
    proposalSearchRevision.current += 1
    void resolveProposalArea(proposalQuery)
  }

  function scheduleProposalAreaSearch(value: string) {
    setProposalLocating(false)
    proposalGenerationRevision.current += 1
    setProposalProgress('')
    setProposalQuery(value)
    setProposalCenter(null)
    setProposalError('')
    setProposals([])
    onSetProposalPreviews([])
    onPendingPointChange(null)
    setBusy(false)
    if (proposalSearchTimer.current !== null) window.clearTimeout(proposalSearchTimer.current)
    const revision = proposalSearchRevision.current + 1
    proposalSearchRevision.current = revision
    if (!value.trim() || value.trim() === '現在地') return
    proposalSearchTimer.current = window.setTimeout(() => { void resolveProposalArea(value.trim(), revision) }, 550)
  }

  async function handleCurrentLocationForProposal() {
    if (proposalSearchTimer.current !== null) window.clearTimeout(proposalSearchTimer.current)
    proposalSearchRevision.current += 1
    const revision = proposalSearchRevision.current
    proposalGenerationRevision.current += 1
    setProposalCenter(null)
    setProposalQuery('')
    setProposals([]); onSetProposalPreviews([])
    onPendingPointChange(null)
    setProposalLocating(true)
    setProposalProgress('')
    setBusy(true); setProposalError('')
    try {
      const result = await currentSearchLocation()
      if (revision !== proposalSearchRevision.current) return
      setProposalCenter(result)
      setProposalQuery('現在地')
      setProposals([])
      onCurrentLocationChange(result.coordinate)
      onFocusPoint(result.coordinate)
      onPendingPointChange(null)
    } catch (error) {
      if (revision === proposalSearchRevision.current) setProposalError(error instanceof Error ? error.message : '現在地を取得できませんでした')
    } finally {
      if (revision === proposalSearchRevision.current) { setBusy(false); setProposalLocating(false) }
    }
  }

  async function addProposalVia() {
    if (!proposalViaQuery.trim()) return
    setBusy(true); setProposalError('')
    try {
      const result = await geocodeJapanesePlace(proposalViaQuery)
      setProposalVias((items) => items.some((item) => item.label === result.label) ? items : [...items, result])
      setProposalViaQuery('')
      onFocusPoint(result.coordinate)
      onPendingPointChange(null)
    } catch (caught) { setProposalError(caught instanceof Error ? caught.message : '経由地を検索できませんでした') }
    finally { setBusy(false) }
  }

  async function setProposalAnchor(kind: 'start' | 'goal') {
    const queryValue = kind === 'start' ? proposalStartQuery : proposalGoalQuery
    if (!queryValue.trim()) return
    setBusy(true); setProposalError('')
    try {
      const result = await geocodeJapanesePlace(queryValue)
      if (kind === 'start') { setProposalStart(result); setProposalStartQuery('') }
      else { setProposalGoal(result); setProposalGoalQuery('') }
      onFocusPoint(result.coordinate)
    } catch (caught) { setProposalError(caught instanceof Error ? caught.message : `${kind === 'start' ? 'スタート' : 'ゴール'}地点を検索できませんでした`) }
    finally { setBusy(false) }
  }

  async function generateProposals() {
    if (proposalLocating || !proposalCenter) { setProposalError('まず探索するエリアを指定してください'); return }
    const revision = ++proposalGenerationRevision.current
    setBusy(true); setProposalError(''); setProposals([]); onSetProposalPreviews([]); setProposalProgress('OpenStreetMapから道路形状を取得しています…')
    const request = buildDriveProposalRequest({
      center: proposalCenter.coordinate, radiusKm: proposalRadiusKm, maxDistanceKm: proposalMaxDistanceKm,
      proposalCount, toll: proposalToll, style: proposalStyle, requiredPoints: proposalVias, startPoint: proposalStart, goalPoint: proposalGoal,
    })
    try {
      const external = await discoverExternalDriveProposals(request)
      if (revision !== proposalGenerationRevision.current) return
      setProposalProgress('道路のカーブ・標高・通行条件を確認しています…')
      if (!external.length) { setProposalError('この条件では新しいコースを見つけられませんでした。探索範囲・距離・料金条件を変えて再試行してください。'); return }
      setProposals(external)
      onSetProposalPreviews(external)
    } catch (caught) {
      if (revision !== proposalGenerationRevision.current) return
      setProposals([]); onSetProposalPreviews([])
      const message = caught instanceof Error ? caught.message : ''
      setProposalError(caught instanceof RoadDiscoveryUnavailableError
        ? '道路・標高データを取得できず、探索を完了できませんでした。コースがないという意味ではありません。通信状態を確認して再試行してください。'
        : message.includes('条件に合う') || message.includes('見つけられませんでした')
        ? '指定した条件に合う峠道を見つけられませんでした。必ず通る地点や始点・ゴールの距離条件を確認してください。'
        : '峠道の探索を完了できませんでした。少し待ってから、もう一度お試しください。')
    } finally { if (revision === proposalGenerationRevision.current) { setBusy(false); setProposalProgress('') } }
  }

  function chooseProposal(proposal: DriveProposal) {
    const append = route.length > 0
    onUseProposal(proposal, append ? 'append' : 'replace', append ? viaInsertAfter : null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (route.length < 2 || !hasGoal) { setError('地図上で始点とゴールを指定してください。'); setStage('route'); return }
    if (exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)) { setError(`地点は${WAYPOINT_LIMIT}個以下にしてください。不要な経由地を削除してから保存してください。`); setStage('route'); return }
    const defaults = buildCourseDraftDefaults(pointLabels)
    const draft: CourseDraft = {
      name: details.name.trim() || defaults.name, area: details.area.trim() || defaults.area, prefecture: details.prefecture, description: details.description.trim(), route,
      editorStops: editorStopsForSave(route, pointLabels, pointRoles),
      tags: parseHashTags(details.tags), cautions: details.cautions.split('\n').map((item) => item.trim()).filter(Boolean), tollStatus: details.tollStatus, visibility: details.visibility, allowedViewerIds: details.allowedViewerIds, blockedViewerIds: details.blockedViewerIds,
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

  return <div className="modal-backdrop" role="presentation"><section data-map-occlusion="bottom-sheet" className={`modal course-form ${sheet.className} ${previewActive ? 'covered-by-detail' : ''} surface-${transitionState}`} style={sheet.style} aria-label="ルートビルダー">
    <div className="mobile-sheet-drag-region" {...sheet.dragProps} onClick={sheet.expandOnTap}><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">ROUTE BUILDER</p><h2>{editingCourse ? 'コースを編集' : 'コースを作る'}</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
    </div>
    <div className="course-form-scroll" data-sheet-scroll {...sheet.scrollProps}>
    {stage === 'route' ? <div className="route-builder-stage">
      <section className="route-builder-intro" aria-label="コースに追加する方法"><div><p className="eyebrow">ROUTE COMPOSER</p><h3>{route.length ? 'コースに追加する' : 'コースを組み立てる'}</h3></div><button type="button" className={`proposal-launch ${proposalOpen ? 'active' : ''}`} onClick={() => { setProposalOpen((value) => !value); setSearchError('') }} aria-expanded={proposalOpen} aria-controls="drive-proposal-builder">✨ 峠道を探す <span aria-hidden="true">{proposalOpen ? '−' : '+'}</span></button></section>
      {proposalOpen && <section id="drive-proposal-builder" className="drive-proposal-builder" aria-label="範囲からドライブコースを提案">
        <div><p className="eyebrow">TOUGE FINDER</p><h3>このあたりの峠道を探す</h3></div>
        <form className="route-search proposal-area-search" onSubmit={findProposalArea}><input value={proposalQuery} onChange={(event) => scheduleProposalAreaSearch(event.target.value)} placeholder="地名・住所・IC・峠を入力すると自動で探索地点に設定" aria-label="走りたい場所を検索" />{busy && <span className="proposal-area-status" role="status">検索中…</span>}</form>
        <div className="proposal-current-location"><button type="button" className="text-button" onClick={() => void handleCurrentLocationForProposal()} disabled={busy || proposalLocating}>{proposalLocating ? '◎ 現在地を取得中…' : '◎ 現在地を使う'}</button>{proposalCenter && <strong>探索地点: {proposalCenter.label}</strong>}</div>
        <button type="button" className={`proposal-settings-toggle ${proposalSettingsOpen ? 'open' : ''}`} onClick={() => setProposalSettingsOpen((value) => !value)} aria-expanded={proposalSettingsOpen} aria-controls="proposal-settings">詳細条件 <span aria-hidden="true">{proposalSettingsOpen ? '−' : '+'}</span></button>
        <p className="proposal-map-point-help">作成中の地点は探索条件に含めません。通過地点はこの詳細条件で指定したものだけを使います。</p>
        {(proposalStart || proposalGoal || proposalVias.length > 0) && <div className="proposal-via-tags" aria-label="探索に適用する通過条件">
          {proposalStart && <span>START: {proposalStart.label}<button type="button" onClick={() => setProposalStart(null)} aria-label="スタート地点を削除">×</button></span>}
          {proposalVias.map((point, index) => <span key={`${point.label}-${index}`}>経由: {point.label}<button type="button" onClick={() => setProposalVias((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${point.label}を除外`}>×</button></span>)}
          {proposalGoal && <span>GOAL: {proposalGoal.label}<button type="button" onClick={() => setProposalGoal(null)} aria-label="ゴール地点を削除">×</button></span>}
          <button type="button" className="button secondary" onClick={() => { setProposalStart(null); setProposalGoal(null); setProposalVias([]) }}>通過条件を解除</button>
        </div>}
        <div id="proposal-settings" className={`proposal-settings ${proposalSettingsOpen ? 'open' : ''}`} aria-hidden={!proposalSettingsOpen} inert={!proposalSettingsOpen}><div className="proposal-settings-inner">
          <div className="proposal-grid">
            <label>探索半径<select value={proposalRadiusKm} onChange={(event) => setProposalRadiusKm(Number(event.target.value))}><option value={5}>5km</option><option value={10}>10km</option><option value={25}>25km</option><option value={50}>50km</option><option value={100}>100km</option></select></label>
            <label>最大距離<select value={proposalMaxDistanceKm} onChange={(event) => setProposalMaxDistanceKm(Number(event.target.value))}>{[2, 3, 4, 5, 6, 8, 10, 15, 20, 40].map((distance) => <option key={distance} value={distance}>{distance}km</option>)}</select></label>
            <label>提案数<select value={proposalCount} onChange={(event) => setProposalCount(Number(event.target.value))}><option value={1}>1案</option><option value={2}>2案</option><option value={3}>3案</option><option value={4}>4案</option><option value={5}>5案</option></select></label>
            <label>走り方<select value={proposalStyle} onChange={(event) => setProposalStyle(event.target.value as DriveStyle)}><option value="winding">ワインディング重視</option><option value="balanced">バランス</option><option value="easy">走りやすさ重視</option></select></label>
            <label>料金<select value={proposalToll} onChange={(event) => setProposalToll(event.target.value as 'all' | TollStatus)}><option value="all">指定なし</option><option value="free">無料のみ</option><option value="toll">有料道路</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select></label>
          </div>
          <div className="proposal-anchor-grid">
            <div className="proposal-via"><label>スタート地点（任意）<input value={proposalStartQuery} onChange={(event) => setProposalStartQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void setProposalAnchor('start') } }} placeholder="地名・住所・地図タップ" /></label><button type="button" className="button secondary" onClick={() => void setProposalAnchor('start')} disabled={busy}>設定</button></div>
            <div className="proposal-via"><label>ゴール地点（任意）<input value={proposalGoalQuery} onChange={(event) => setProposalGoalQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void setProposalAnchor('goal') } }} placeholder="地名・住所・地図タップ" /></label><button type="button" className="button secondary" onClick={() => void setProposalAnchor('goal')} disabled={busy}>設定</button></div>
          </div>
          <div className="proposal-via"><label>必ず通りたい地点<input value={proposalViaQuery} onChange={(event) => setProposalViaQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addProposalVia() } }} placeholder="例: 大観山、三国峠。地図タップでも追加できます" /></label><button type="button" className="button secondary" onClick={() => void addProposalVia()} disabled={busy}>追加</button></div>
          <p className="proposal-map-point-help">地図をタップすると、必須地点・スタート・ゴールを選んで追加できます。追加済みのピンをタップすると削除できます。</p>
        </div></div>
        {proposalError && <p className="form-error" role="alert">{proposalError}</p>}
        <button type="button" className="button primary proposal-generate" onClick={generateProposals} disabled={!proposalCenter || busy || proposalLocating}>{proposalLocating ? '現在地を取得中…' : busy ? '峠道を検証中…' : `この条件で${proposalCount}案を見る`}</button>
        {proposalProgress && <div className="proposal-loading" role="status" aria-live="polite"><span aria-hidden="true" /><div><strong>峠適格の道路を検証しています</strong><small>{proposalProgress}</small></div></div>}
        {proposals.length > 0 && <div className="proposal-results" aria-live="polite"><p className="proposal-map-hint">{proposals.length}案を地図へ一時表示中です。ラインまたは「プレビュー」で、保存前の詳細を確認できます。</p>{proposals.map((proposal, index) => <article key={proposal.id}><span>候補 {index + 1} · {proposal.source === 'openstreetmap' ? '外部道路から発見' : '登録済みコース'}</span><h4>{proposal.name}</h4><p>{proposal.area} · {proposal.distanceKm.toFixed(1)}km · {tollStatusLabels[proposal.tollStatus]}</p><ul>{proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{proposal.validation && <small className="proposal-validation">品質検証済み: 最大欠落 {proposal.validation.maxGapKm.toFixed(2)}km · {proposal.validation.elevationSource}</small>}<div className="proposal-actions"><button type="button" className="button secondary" onClick={() => { sheet.reset(); onOpenProposalPreview(proposal.id) }}>プレビュー</button><button type="button" className="button primary" onClick={() => chooseProposal(proposal)}>{route.length ? 'この候補をルートに追加 →' : 'この候補を使う →'}</button></div></article>)}</div>}
      </section>}
      {hasProposalEditSnapshot && proposals.length > 0 && <button type="button" className="proposal-edit-back" onClick={() => { onUndoProposalEdit(); setProposalOpen(true); setSearchNotice('候補を採用する前の状態に戻しました。別の候補を選べます。') }}>← 候補を採用する前に戻る</button>}
      <section className="existing-route-insert" aria-label="既存コースをルートへ組み込む">
        <button type="button" className="existing-route-toggle" onClick={() => setCourseLibraryOpen((value) => !value)} aria-expanded={courseLibraryOpen} aria-controls="existing-route-library">
          <span aria-hidden="true">⇄</span><strong>既存コースを組み込む</strong><small>{viaInsertAfter !== null ? '選んだ追加先の直後へ道順を追加' : '今のゴールの直前へ道順を追加'}</small><b aria-hidden="true">{courseLibraryOpen ? '−' : '+'}</b>
        </button>
        <div id="existing-route-library" className={`existing-route-library ${courseLibraryOpen ? 'open' : ''}`} aria-hidden={!courseLibraryOpen} inert={!courseLibraryOpen}>
          <div className="existing-route-library-inner">
            <input value={courseLibraryQuery} onChange={(event) => setCourseLibraryQuery(event.target.value)} placeholder="コース名・エリア・タグで絞り込み" aria-label="組み込む既存コースを検索" />
            <p>選んだコースを現在の地点列へ追加します。追加先を選んでいる場合はその直後、それ以外はゴールの直前に組み込みます。</p>
            <div className="existing-route-results">{incorporableCourses.map((course) => <button key={course.id} type="button" onClick={() => { onIncorporateCourse(course, viaInsertAfter); setCourseLibraryOpen(false); setCourseLibraryQuery(''); setSearchNotice(`「${course.name}」をルートに組み込みました。必要なら地点の順番を調整できます。`) }}><span>＋</span><div><strong>{course.name}</strong><small>{course.area} · {course.distanceKm.toFixed(1)} km</small></div></button>)}</div>
          </div>
        </div>
      </section>
      <form className="route-search" onSubmit={addSearchedPlace}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="地名・住所・IC・峠・コースを検索" aria-label="ルートへ追加する場所または住所を検索" /><button disabled={busy || addingCurrentLocation}>{busy ? '検索中…' : '地点を検索'}</button></form>
      <button type="button" className="route-current-location" onClick={() => void addCurrentLocation()} disabled={busy || addingCurrentLocation}>{addingCurrentLocation ? '◎ 現在地を取得中…' : '◎ 現在地を追加'}</button>
      {searchError && <section className="search-not-found" role="alert"><strong>{searchError.includes('現在地') || searchError.includes('端末') ? '現在地を取得できませんでした' : '場所が見つかりませんでした'}</strong><p>{searchError}</p><small>{searchError.includes('現在地') || searchError.includes('端末') ? '位置情報の利用を許可するか、地名・住所・地図タップで地点を追加してください。' : '地点は追加されていません。地名の一部・施設名・IC名で検索し直すか、地図をタップして正確な位置を指定してください。'}</small></section>}
      {pendingSearchPoint && <section className="address-match-confirm" aria-label="検索結果の確認"><strong>検索結果を確認</strong><span>{pendingSearchPoint.label}</span><small>{pendingSearchPoint.level ? `住所レベル ${pendingSearchPoint.level} の位置です。建物の入口ではなく、住所代表点の場合があります。` : '地図上の赤い仮ピンを確認してから追加してください。'}</small><div><button type="button" className="button secondary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'via', viaInsertAfter); setSearchNotice(route.length ? '経由地として追加しました。必要なら地図上のピンを長押しして調整できます。' : '始点として追加しました。次に経由地またはゴールを追加してください。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>{route.length ? '経由地として追加' : '始点として追加'}</button>{route.length > 0 && <button type="button" className="button primary" onClick={() => { onAddPoint(pendingSearchPoint.coordinate, pendingSearchPoint.label, 'goal'); setSearchNotice('ゴールとして追加しました。'); setPendingSearchPoint(null); onPendingPointChange(null) }}>ゴールとして追加</button>}<button type="button" className="text-button" onClick={() => { setPendingSearchPoint(null); onPendingPointChange(null) }}>追加しない</button></div></section>}
      {courseMatches.length > 0 && <div className="route-search-results">{courseMatches.map((course) => <button key={course.id} type="button" onClick={() => { onIncorporateCourse(course, viaInsertAfter); setQuery(''); setSearchNotice(`「${course.name}」をルートに組み込みました。必要なら地点の順番を調整できます。`) }}><strong>{course.name}</strong><small>{course.area} · コース全体を組み込む</small></button>)}</div>}
      <p className="route-builder-help">最初の地点が始点になります。次の地点は「経由地」か「ゴール」を選べます。途中へ追加する場合は地点一覧の「＋」で追加先を指定できます。</p>
      <RouteOrderEditor blocks={routeBlocks} onMove={onMoveRouteBlock} onReverse={onReverseRouteBlock} />
      <div className="route-stop-list">{route.length ? route.map((point, index) => { const role = pointRoles[index] ?? (index === 0 ? 'start' : index === route.length - 1 ? 'goal' : 'via'); const roleText = role === 'start' ? 'START' : role === 'goal' ? 'GOAL' : `経由 ${pointRoles.slice(0, index + 1).filter((item) => item === 'via').length || index}`; return <div key={`${point[0]}-${point[1]}-${index}`}><b>{roleText}</b><span><strong>{pointLabels[index] || '地図指定'}</strong><small>{point[1].toFixed(5)}, {point[0].toFixed(5)}</small></span>{role !== 'goal' && <button type="button" className={`insert-stop ${viaInsertAfter === index ? 'active' : ''}`} onClick={() => onChooseViaInsertion(viaInsertAfter === index ? null : index)} aria-label={`${roleText}の直後に経由地を追加`}>{viaInsertAfter === index ? '追加先' : '後に追加'}</button>}<button type="button" onClick={() => onRemovePoint(index)} aria-label={`${roleText}を削除`}>×</button></div> }) : <p>まだ地点がありません</p>}</div>
      {route.length >= 2 && !hasGoal && <button type="button" className="set-goal-button" onClick={onSetFinalPointAsGoal}>現在の最後の地点をゴールに設定</button>}
      {route.length >= 2 && hasGoal && <button type="button" className="reverse-route-button" onClick={onReverseRoute}>⇄ 始点とゴールを入れ替える</button>}
      <div className="route-builder-summary"><strong className={exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints) ? 'form-error' : ''}>{canUseUnlimitedWaypoints ? `${route.length}地点` : `${route.length} / ${WAYPOINT_LIMIT}地点`}</strong><span>約 {routeDistanceKm(route).toFixed(1)} km</span></div>
      {searchNotice && <p className="form-success" role="status">{searchNotice}</p>}
      <p className="route-privacy-note">自宅などの住所を追加する場合、公開範囲は「フレンド・リンク限定」または「非公開」を推奨します。保存されるのはルート上の位置情報です。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button primary" disabled={route.length < 2 || !hasGoal || exceedsWaypointLimit(route.length, canUseUnlimitedWaypoints)} onClick={openDetails}>詳細へ →</button></footer>
    </div> : <form className="route-details-stage" onSubmit={submit}>
      <button type="button" className="text-button" onClick={() => setStage('route')}>← ルートを修正</button>
      <div className="form-grid">
        <label>コース名<input value={details.name} onChange={(event) => setDetails((previous) => ({ ...previous, name: event.target.value }))} placeholder="地点名から自動入力されます" /></label><label>エリア<input value={details.area} onChange={(event) => setDetails((previous) => ({ ...previous, area: event.target.value }))} placeholder="例: 伊豆・湘南。経路から自動入力" /><small className="tag-help">複数地域をまたぐ場合は「・」区切りで保存します。</small></label>
        <label>都道府県<input value={details.prefecture} list="course-prefecture-suggestions" onChange={(event) => setDetails((previous) => ({ ...previous, prefecture: event.target.value }))} placeholder="経路から自動入力" /><small className="tag-help">複数県をまたぐ場合は「・」区切りで保存します。</small></label><label>公開範囲<select value={details.visibility} onChange={(event) => setDetails((previous) => ({ ...previous, visibility: event.target.value as CourseDraft['visibility'] }))}><option value="public">一般公開</option><option value="limited">フレンド・リンク限定</option><option value="private">非公開</option></select></label>
        <datalist id="course-prefecture-suggestions">{JAPANESE_PREFECTURES.map((item) => <option key={item} value={item} />)}</datalist>
        <div className="wide tag-help administrative-lookup" role="status">{administrativeLookup === 'loading' ? '経路上の都道府県・エリアを確認中…' : administrativeLookup === 'failed' ? <>地域を自動判定できませんでした。入力内容はそのまま保存できます。 <button type="button" className="text-button" onClick={() => void enrichAdministrativeAreas({ area: details.area, prefecture: details.prefecture })}>再判定</button></> : '経路から都道府県・エリアを自動補完しました。必要に応じて編集できます。'}</div>
        {details.visibility === 'limited' && <section className="wide course-share-picker"><h3>共有相手</h3>{(effectiveProfile?.followingIds ?? []).length > 0 ? <><label className="toggle-row"><input type="checkbox" checked={effectiveProfile!.followingIds.every((id) => details.allowedViewerIds.includes(id))} onChange={(event) => setDetails((previous) => ({ ...previous, allowedViewerIds: event.target.checked ? [...new Set([...previous.allowedViewerIds, ...effectiveProfile!.followingIds])] : previous.allowedViewerIds.filter((id) => !effectiveProfile!.followingIds.includes(id)) }))} />フレンド全員</label>{(effectiveProfile?.friendLists ?? []).map((list) => <label className="toggle-row" key={list.id}><input type="checkbox" checked={list.memberIds.length > 0 && list.memberIds.every((id) => details.allowedViewerIds.includes(id))} onChange={(event) => setDetails((previous) => ({ ...previous, allowedViewerIds: event.target.checked ? [...new Set([...previous.allowedViewerIds, ...list.memberIds])] : previous.allowedViewerIds.filter((id) => !list.memberIds.includes(id)) }))} />{list.name}（{list.memberIds.length}人）</label>)}</> : <p>共有できるフレンドがいません。先にプロフィールからフォロー・リスト設定を行ってください。</p>}</section>}
        <label className="wide">料金区分<select value={details.tollStatus} onChange={(event) => setDetails((previous) => ({ ...previous, tollStatus: event.target.value as TollStatus }))}><option value="unknown">料金情報未確認</option><option value="free">無料</option><option value="toll">有料</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option></select><small className="tag-help">不明な場合は「料金情報未確認」のまま保存します。無料と推測して登録しません。</small></label>
        <label className="wide">説明（任意）<textarea value={details.description} onChange={(event) => setDetails((previous) => ({ ...previous, description: event.target.value }))} rows={3} placeholder="コースの特徴やおすすめポイント" /></label><label className="wide">タグ（任意）<input value={details.tags} onChange={(event) => setDetails((previous) => ({ ...previous, tags: event.target.value }))} list="course-tag-suggestions" placeholder="#ワイド, #高原, #展望" /><datalist id="course-tag-suggestions">{recommendedTags.map((tag) => <option key={tag} value={`#${tag}`} />)}</datalist><small className="tag-help">#から始まる語だけを保存します。カンマまたは空白で区切れます。</small></label>
        {recommendedTags.length > 0 && <div className="wide tag-recommendations" aria-label="おすすめのタグ"><span>おすすめ</span>{recommendedTags.map((tag) => <button key={tag} type="button" onClick={() => addRecommendedTag(tag)}>#{tag}</button>)}</div>}
        <label className="wide">注意事項（任意）<textarea value={details.cautions} onChange={(event) => setDetails((previous) => ({ ...previous, cautions: event.target.value }))} rows={2} placeholder="1行に1件。通行規制や狭路など" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '道路・標高を確認して保存中…' : 'コースを保存'}</button></footer>
    </form>}
    </div>
  </section></div>
}
