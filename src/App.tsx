import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { MapView } from './components/MapView'
import { CourseList } from './components/CourseList'
import { CourseDetail } from './components/CourseDetail'
import { CourseForm } from './components/CourseForm'
import { RatingForm } from './components/RatingForm'
import { InstallPrompt } from './components/InstallPrompt'
import { Course3DView } from './components/Course3DView'
import { TollReportForm, type TollReport } from './components/TollReportForm'
import { CommunityPanel } from './components/CommunityPanel'
import { CourseManageForm } from './components/CourseManageForm'
import { sampleCourses } from './data/courses'
import { addUserRating, combinedRatings, estimateSystemRatings, validateRouteQuality } from './lib/course'
import { fetchElevationProfile, type ElevationResult } from './lib/elevation'
import { auth, completeRedirectLogin, createCourse, deleteCourse, loadCourseById, loadPublicCourses, loginWithGoogle, logout, saveRating, submitTollReport, updateCourse, updateCourseElevation } from './lib/firebase'
import { routeAlongRoads } from './lib/routing'
import type { Coordinate, Course, CourseDraft, DraftPointRole, RatingSubmission } from './types'
import { useMobileSheet } from './hooks/useMobileSheet'
import { canUseUnlimitedWaypoints, exceedsWaypointLimit, WAYPOINT_LIMIT } from './lib/access'
import './styles.css'

type PrefectureFilter = 'すべて' | Course['prefecture']

export default function App() {
  const logoutSheet = useMobileSheet()
  const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`
  const [courses, setCourses] = useState<Course[]>(sampleCourses)
  // A course is selected only after the driver chooses one (or opens a shared link).
  // Opening directly on the map must not silently focus an arbitrary sample course.
  const [selected, setSelected] = useState<Course | null>(null)
  const [search, setSearch] = useState('')
  const [prefecture, setPrefecture] = useState<PrefectureFilter>('すべて')
  const [sort, setSort] = useState<'recommended' | 'curves' | 'elevation' | 'width'>('recommended')
  const [is3d, setIs3d] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [surfaceMotion, setSurfaceMotion] = useState<'idle' | 'leaving-list' | 'leaving-form' | 'entering-list' | 'entering-form'>('idle')
  const [draftRoute, setDraftRoute] = useState<Coordinate[]>([])
  const [draftPointLabels, setDraftPointLabels] = useState<string[]>([])
  const [draftPointRoles, setDraftPointRoles] = useState<DraftPointRole[]>([])
  const [draftViaInsertAfter, setDraftViaInsertAfter] = useState<number | null>(null)
  const [draftFocus, setDraftFocus] = useState<Coordinate | null>(null)
  const [draftPendingSearch, setDraftPendingSearch] = useState<{ point: Coordinate; label: string } | null>(null)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [course3dOpen, setCourse3dOpen] = useState(false)
  const [tollReportOpen, setTollReportOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [listCollapsed, setListCollapsed] = useState(false)
  const [listExpanded, setListExpanded] = useState(false)
  const [listOffset, setListOffset] = useState(0)
  const [listDragging, setListDragging] = useState(false)
  const listDrag = useRef<{ pointerId: number; y: number; moved: boolean } | null>(null)
  const ignoreListTap = useRef(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [courseManagerOpen, setCourseManagerOpen] = useState(false)
  const surfaceTimer = useRef<number | null>(null)
  const unlimitedWaypoints = canUseUnlimitedWaypoints(user)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser)
    completeRedirectLogin().catch((error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setNotice(code ? `Googleログインを完了できませんでした（${code}）。Firebase Authenticationの設定を確認してください。` : 'Googleログインを完了できませんでした。もう一度お試しください。')
    })
    return unsubscribe
  }, [])
  useEffect(() => { window.__tougeMarkReady?.() }, [])
  useEffect(() => {
    loadPublicCourses(user?.uid).then((remote) => {
      if (remote.length) {
        const seedIds = new Set(remote.map((course) => course.id))
        setCourses([...remote, ...sampleCourses.filter((course) => !seedIds.has(course.id))])
      }
    }).catch((error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setNotice(code === 'permission-denied' ? 'Firebaseからコースを読み込めませんでした。Firestoreルールの公開設定を確認してください。' : 'Firebaseからコースを読み込めませんでした。通信状態を確認してください。')
    })
  }, [user?.uid])
  useEffect(() => {
    const courseId = new URLSearchParams(location.search).get('course')
    if (!courseId) return
    const local = sampleCourses.find((course) => course.id === courseId)
    if (local) { setSelected(local); return }
    loadCourseById(courseId).then((course) => {
      if (course) { setCourses((items) => items.some((item) => item.id === course.id) ? items : [course, ...items]); setSelected(course) }
      else setNotice('共有されたコースが見つかりませんでした')
    }).catch(() => setNotice('共有されたコースを読み込めませんでした'))
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  useEffect(() => () => {
    if (surfaceTimer.current !== null) window.clearTimeout(surfaceTimer.current)
  }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ja')
    return courses
      .filter((course) => prefecture === 'すべて' || course.prefecture === prefecture)
      .filter((course) => !query || `${course.name}${course.area}${course.description}${course.tags.join('')}`.toLocaleLowerCase('ja').includes(query))
      .sort((a, b) => {
        if (sort === 'recommended') return (b.ratings.curves + b.ratings.elevation + b.ratings.width) - (a.ratings.curves + a.ratings.elevation + a.ratings.width)
        return b.ratings[sort] - a.ratings[sort]
      })
  }, [courses, prefecture, search, sort])

  const selectCourse = useCallback((course: Course) => { setSelected(course); setListCollapsed(true) }, [])
  const addPoint = useCallback((point: Coordinate, label = '地図指定', requestedRole: 'via' | 'goal' = 'via', requestedInsertAfter: number | null = null) => {
    // Keep all three parallel arrays in the same operation. A new via point is
    // placed before an existing goal; choosing a new goal promotes the old one
    // to a via point and makes the newly selected location the route endpoint.
    setDraftPointRoles((roles) => {
      const goalIndex = roles.indexOf('goal')
      const automaticInsertAt = goalIndex >= 0 ? goalIndex : roles.length
      const insertAt = requestedRole === 'via' && requestedInsertAfter !== null
        ? Math.min(Math.max(1, requestedInsertAfter + 1), goalIndex >= 0 ? goalIndex : roles.length)
        : requestedRole === 'via' ? automaticInsertAt : roles.length
      const nextRoles: DraftPointRole[] = roles.length === 0
        ? ['start']
        : requestedRole === 'goal'
          ? [...roles.map((role) => role === 'goal' ? 'via' : role), 'goal']
          : [...roles.slice(0, insertAt), 'via', ...roles.slice(insertAt)]
      setDraftRoute((route) => roles.length === 0 || requestedRole === 'goal' ? [...route, point] : [...route.slice(0, insertAt), point, ...route.slice(insertAt)])
      setDraftPointLabels((labels) => roles.length === 0 || requestedRole === 'goal' ? [...labels, label] : [...labels.slice(0, insertAt), label, ...labels.slice(insertAt)])
      setDraftViaInsertAfter(null)
      return nextRoles
    })
  }, [])
  function resetListSheet() {
    setListCollapsed(false); setListExpanded(false); setListOffset(0); setListDragging(false)
  }

  function finishSurfaceMotion(next: 'list' | 'form', resolve?: () => void) {
    if (surfaceTimer.current !== null) window.clearTimeout(surfaceTimer.current)
    surfaceTimer.current = window.setTimeout(() => {
      setDrawing(next === 'form')
      setSurfaceMotion(next === 'form' ? 'entering-form' : 'entering-list')
      surfaceTimer.current = window.setTimeout(() => {
        setSurfaceMotion('idle')
        surfaceTimer.current = null
        resolve?.()
      }, 280)
    }, 220)
  }

  function openCourseList() {
    if (!drawing) { resetListSheet(); return }
    setSurfaceMotion('leaving-form')
    setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftFocus(null); setDraftPendingSearch(null)
    resetListSheet()
    finishSurfaceMotion('list')
  }

  function startListDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    listDrag.current = { pointerId: event.pointerId, y: event.clientY, moved: false }
    setListDragging(true)
  }
  function moveListDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = listDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = event.clientY - drag.y
    if (Math.abs(distance) > 8) drag.moved = true
    setListOffset(listCollapsed ? Math.min(0, distance) : Math.max(0, distance))
  }
  function endListDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = listDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = event.clientY - drag.y
    listDrag.current = null
    setListDragging(false)
    setListOffset(0)
    ignoreListTap.current = drag.moved
    if (drag.moved) window.setTimeout(() => { ignoreListTap.current = false }, 0)
    if (listCollapsed) {
      if (distance < -42) { setListCollapsed(false); setListExpanded(true) }
      return
    }
    if (distance > 52) { setListCollapsed(true); setListExpanded(false) }
    else if (distance < -52) setListExpanded(true)
    else if (distance > 24) setListExpanded(false)
  }
  function tapListHandle() {
    if (ignoreListTap.current || !listCollapsed) return
    // A tap opens the normal resting panel; only an upward swipe fully expands it.
    setListCollapsed(false)
    setListExpanded(false)
    setListOffset(0)
  }

  async function handleLogin() {
    setAuthBusy(true)
    try {
      const result = await loginWithGoogle()
      if (result) setNotice('ログインしました')
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setNotice(code ? `Googleログインを完了できませんでした（${code}）。Firebase Authenticationの設定を確認してください。` : 'Googleログインを完了できませんでした。もう一度お試しください。')
    }
    finally { setAuthBusy(false) }
  }

  async function handleLogout() {
    try {
      await logout()
      setLogoutConfirmOpen(false)
      logoutSheet.reset()
      setNotice('ログアウトしました')
    } catch {
      setNotice('ログアウトできませんでした。もう一度お試しください。')
    }
  }

  function startDrawing() {
    if (drawing) return Promise.resolve()
    setSurfaceMotion('leaving-list')
    return new Promise<void>((resolve) => {
      finishSurfaceMotion('form', resolve)
      setSelected(null); setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftFocus(null); setDraftPendingSearch(null)
    })
  }

  async function openCreateFlow() {
    if (!user) { await handleLogin(); if (!auth.currentUser) return }
    await startDrawing()
  }

  async function handleCreate(draft: CourseDraft) {
    const activeUser = auth.currentUser
    if (!activeUser) throw new Error('Authentication required')
    if (exceedsWaypointLimit(draft.route.length, canUseUnlimitedWaypoints(activeUser))) throw new Error(`地点は${WAYPOINT_LIMIT}個以下にしてください`)
    const quality = validateRouteQuality(draft.route)
    if (!quality.ok) throw new Error(`ルート検証: ${quality.warnings.join('、')}`)
    let routed
    try { routed = await routeAlongRoads(draft.route) }
    catch (error) { throw new Error(error instanceof Error ? error.message : '道路ルートを取得できませんでした') }
    const elevationResult = await fetchElevationProfile(routed.route)
    const elevation = elevationResult.values
    const systemRatings = estimateSystemRatings(routed.route, elevation, draft.tags)
    const data: Omit<Course, 'id'> = {
      ...draft,
      route: routed.route,
      distanceKm: routed.distanceKm,
      durationMin: routed.durationMin,
      minElevation: Math.min(...elevation),
      maxElevation: Math.max(...elevation),
      elevationProfile: elevation,
      elevationSource: elevationResult.source,
      ratings: systemRatings,
      systemRatings,
      ratingCount: 0,
      systemRatingSource: ['道路形状・曲率（道路ルーティング）', `標高・高低差（${elevationResult.source}）`, '登録タグ・公開情報'],
      systemRatingUpdatedAt: new Date().toISOString().slice(0, 10),
      authorId: activeUser.uid,
      authorName: activeUser.displayName ?? 'ドライバー',
      updatedAt: new Date().toISOString().slice(0, 10),
    }
    let id: string
    try { id = await createCourse(data) }
    catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code) throw new Error(`Firebase保存エラー (${code})`)
      throw error
    }
    const created = { id, ...data }
    setCourses((items) => [created, ...items]); setSelected(created); setDrawing(false); setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setNotice(`Firebaseへコースを保存しました（ID: ${id.slice(0, 8)}）`)
  }

  function joinedWaypoints(joinedCourses: Course[]) {
    const samplesPerCourse = Math.max(2, Math.floor(24 / Math.max(1, joinedCourses.length)))
    return joinedCourses.flatMap((item, courseIndex) => Array.from({ length: samplesPerCourse }, (_, index) => item.route[Math.round((index / Math.max(1, samplesPerCourse - 1)) * (item.route.length - 1))]).filter((_, index) => courseIndex === 0 || index > 0))
  }

  function previewJoinedCourses(joinedCourses: Course[]) {
    const waypoints = joinedWaypoints(joinedCourses)
    setDraftRoute(waypoints)
    setDraftPointLabels([])
    setDraftPointRoles([])
    setDraftViaInsertAfter(null)
    setDraftFocus(waypoints[0] ?? null)
  }

  async function handleCreateJoined(joinedCourses: Course[], values: { name: string; visibility: Course['visibility'] }) {
    const activeUser = auth.currentUser
    if (!activeUser || joinedCourses.length < 2) throw new Error('Authentication required')
    const waypoints = joinedWaypoints(joinedCourses)
    const routed = await routeAlongRoads(waypoints)
    const route = routed.route
    const elevationResult = await fetchElevationProfile(route)
    const elevation = elevationResult.values
    const systemRatings = estimateSystemRatings(route, elevation, [...new Set(joinedCourses.flatMap((item) => item.tags))])
    const data: Omit<Course, 'id'> = {
      name: values.name, area: joinedCourses.map((item) => item.area).join(' → '), prefecture: joinedCourses[0].prefecture,
      description: `${joinedCourses.map((item) => item.name).join('、')}を順番に走るオリジナル連結コースです。`, route, tags: ['オリジナル', '連結コース'], cautions: ['各区間の通行規制・料金情報を個別に確認してください。'], visibility: values.visibility, authorId: activeUser.uid, authorName: activeUser.displayName ?? 'ドライバー',
      distanceKm: routed.distanceKm, durationMin: routed.durationMin, minElevation: Math.min(...elevation), maxElevation: Math.max(...elevation), elevationProfile: elevation, elevationSource: elevationResult.source, ratings: systemRatings, systemRatings, ratingCount: 0,
      systemRatingSource: [`連結元コースの道路形状`, `標高・高低差（${elevationResult.source}）`, '自動ルート品質検証'], systemRatingUpdatedAt: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString().slice(0, 10), isSeed: false,
    }
    const id = await createCourse(data); const created = { id, ...data }; setCourses((items) => [created, ...items]); setSelected(created); setDrawing(false); setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setNotice('オリジナル連結コースを保存しました')
  }

  const handleElevationRepair = useCallback(async (course: Course, elevation: number[], source: ElevationResult['source']) => {
    if (source !== '国土地理院 標高API' || course.authorId !== auth.currentUser?.uid || elevation.length < 2) return
    const systemRatings = estimateSystemRatings(course.route, elevation, course.tags)
    const systemRatingSource = [...(course.systemRatingSource ?? []).filter((item) => !item.startsWith('標高・高低差')), `標高・高低差（${source}）`]
    const base = { ...course, elevationProfile: elevation, elevationSource: source, minElevation: Math.min(...elevation), maxElevation: Math.max(...elevation), systemRatings, ratings: systemRatings, systemRatingSource, systemRatingUpdatedAt: new Date().toISOString().slice(0, 10) }
    const updated = { ...base, ratings: combinedRatings(base) }
    await updateCourseElevation(course.id, {
      elevationProfile: updated.elevationProfile, elevationSource: updated.elevationSource, minElevation: updated.minElevation, maxElevation: updated.maxElevation,
      ratings: updated.ratings, systemRatings: updated.systemRatings, systemRatingSource: updated.systemRatingSource, systemRatingUpdatedAt: updated.systemRatingUpdatedAt,
    })
    setCourses((items) => items.map((item) => item.id === course.id ? updated : item))
    setSelected((item) => item?.id === course.id ? updated : item)
  }, [])

  async function handleTollReport(report: TollReport) {
    if (!selected) return
    if (!user) { await handleLogin(); if (!auth.currentUser) throw new Error('Login required') }
    await submitTollReport(selected.id, report, auth.currentUser!)
    setNotice('料金情報を受け付けました。確認後に反映します。')
  }

  async function handleRating(rating: RatingSubmission) {
    if (!user) { await handleLogin(); throw new Error('Login required') }
    await saveRating(rating, user)
    setCourses((items) => items.map((course) => course.id === rating.courseId ? addUserRating(course, rating) : course))
    setSelected((course) => course && course.id === rating.courseId ? addUserRating(course, rating) : course)
    setNotice('評価を投稿しました。集計への反映には時間がかかる場合があります。')
  }

  async function handleCourseUpdate(courseId: string, changes: Pick<Course, 'name' | 'area' | 'prefecture' | 'description' | 'tags' | 'cautions' | 'visibility'>) {
    const current = courses.find((course) => course.id === courseId)
    if (!current || current.authorId !== auth.currentUser?.uid) throw new Error('Not authorized')
    await updateCourse(courseId, changes)
    const updated = { ...current, ...changes, updatedAt: new Date().toISOString().slice(0, 10) }
    setCourses((items) => items.map((course) => course.id === courseId ? updated : course))
    setSelected((course) => course?.id === courseId ? updated : course)
  }

  async function handleCourseDelete(courseId: string) {
    const current = courses.find((course) => course.id === courseId)
    if (!current || current.authorId !== auth.currentUser?.uid) throw new Error('Not authorized')
    await deleteCourse(courseId)
    setCourses((items) => items.filter((course) => course.id !== courseId))
    setSelected((course) => course?.id === courseId ? null : course)
    setNotice('コースをFirebaseから削除しました')
  }

  async function shareCourse() {
    if (!selected) return
    const url = `${location.origin}${location.pathname}?course=${selected.id}`
    if (navigator.share) await navigator.share({ title: `${selected.name} | 峠`, text: selected.description, url })
    else { await navigator.clipboard.writeText(url); setNotice('共有リンクをコピーしました') }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { openCourseList(); setSelected(null) }} aria-label="峠 ホーム">
          <img src={asset('icons/icon.svg')} alt="" /><span><b>峠</b><small>TOUGE EXPLORER</small></span>
        </button>
        <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="峠・エリア・特徴で検索" aria-label="コースを検索" /></div>
        <div className="top-actions">
          <button className="new-route" onClick={openCreateFlow}><span>＋</span>コース登録</button>
          {user ? <button className="user-button" onClick={() => setCommunityOpen(true)} title="プロフィールとコミュニティ" aria-label="プロフィールとコミュニティ">{user.photoURL ? <img src={user.photoURL} alt="" /> : user.displayName?.slice(0, 1)}<span>{user.displayName ?? 'アカウント'}</span></button> : <button className="login-button" onClick={handleLogin} disabled={authBusy}>{authBusy ? '接続中…' : 'ログイン'}</button>}
        </div>
      </header>

      <main>
        <MapView courses={filtered} selected={selected} is3d={is3d} drawing={drawing} draftRoute={draftRoute} draftLabels={draftPointLabels} draftRoles={draftPointRoles} viaInsertAfter={draftViaInsertAfter} focusPoint={draftFocus} pendingSearchPoint={draftPendingSearch?.point ?? null} pendingSearchLabel={draftPendingSearch?.label ?? ''} onSelect={selectCourse} onAddPoint={(point, label, role, insertAfter) => { addPoint(point, label, role, insertAfter); setDraftFocus(point); setDraftPendingSearch(null) }} onMovePoint={(index, point) => setDraftRoute((route) => route.map((item, itemIndex) => itemIndex === index ? point : item))} />
        <section className={`explore-panel open ${drawing ? 'drawing' : ''} ${listCollapsed ? 'collapsed' : ''} ${listExpanded ? 'expanded' : ''} ${listDragging ? 'dragging' : ''} ${surfaceMotion === 'leaving-list' ? 'surface-leaving' : surfaceMotion === 'entering-list' ? 'surface-entering' : ''}`} style={{ transform: drawing ? undefined : listCollapsed ? `translateY(calc(100% - 54px + ${listOffset}px))` : listOffset ? `translateY(${listOffset}px)` : undefined }} aria-label="コースを探す">
          <div className="explore-panel-top" onPointerDown={startListDrag} onPointerMove={moveListDrag} onPointerUp={endListDrag} onPointerCancel={endListDrag} onClick={tapListHandle}>
            <div className="explore-drag-handle" role="button" tabIndex={0} aria-label="上部全体をタップまたはドラッグしてコース一覧を操作" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') tapListHandle() }} />
          </div>
          <CourseList courses={filtered} selectedId={selected?.id} onSelect={selectCourse} header={<>
            <div className="panel-heading"><div><p className="eyebrow">DISCOVER KANTO</p><h1>走りたい道を探す</h1></div></div>
            <div className="filter-row">
              <select value={prefecture} onChange={(event) => setPrefecture(event.target.value as PrefectureFilter)} aria-label="都県"><option>すべて</option><option>東京都</option><option>神奈川県</option><option>静岡県</option></select>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="並び順"><option value="recommended">おすすめ順</option><option value="curves">カーブ評価順</option><option value="elevation">高低差評価順</option><option value="width">道幅評価順</option></select>
            </div>
            <div className="result-count"><span>{filtered.length} ROUTES</span><small>東京・神奈川・静岡</small></div>
          </>} />
        </section>

        <div className="map-tools">
          <button className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)} aria-pressed={is3d}><span>▰</span>{is3d ? '2Dに戻す' : '3D地形'}</button>
        </div>

        {selected && <CourseDetail course={selected} onClose={() => setSelected(null)} onRate={() => setRatingOpen(true)} onShare={shareCourse} onOpen3d={() => setCourse3dOpen(true)} onReportToll={() => setTollReportOpen(true)} onCommunity={() => setCommunityOpen(true)} canManageCourse={Boolean(user && selected.authorId === user.uid)} onManageCourse={() => setCourseManagerOpen(true)} />}
        {drawing && <CourseForm transitionState={surfaceMotion === 'leaving-form' ? 'leaving' : surfaceMotion === 'entering-form' ? 'entering' : 'idle'} route={draftRoute} pointLabels={draftPointLabels} pointRoles={draftPointRoles} viaInsertAfter={draftViaInsertAfter} courses={courses} canUseUnlimitedWaypoints={unlimitedWaypoints} onAddPoint={(point, label, role, insertAfter) => { addPoint(point, label, role, insertAfter); setDraftFocus(point); setDraftPendingSearch(null) }} onAddCourse={(course) => { const count = Math.min(8, course.route.length); const sampled = Array.from({ length: count }, (_, index) => course.route[Math.round((index / Math.max(1, count - 1)) * (course.route.length - 1))]); sampled.forEach((point) => addPoint(point, course.name, 'via')); setDraftFocus(sampled.at(-1) ?? null); setDraftPendingSearch(null) }} onFocusPoint={setDraftFocus} onPendingPointChange={(point, label = '') => setDraftPendingSearch(point ? { point, label } : null)} onPreviewJoined={previewJoinedCourses} onCreateJoined={handleCreateJoined} onRemovePoint={(index) => { setDraftRoute((route) => route.filter((_, pointIndex) => pointIndex !== index)); setDraftPointLabels((labels) => labels.filter((_, labelIndex) => labelIndex !== index)); setDraftPointRoles((roles) => roles.filter((_, roleIndex) => roleIndex !== index)); setDraftViaInsertAfter(null) }} onChooseViaInsertion={setDraftViaInsertAfter} onUndo={() => { setDraftRoute((route) => route.slice(0, -1)); setDraftPointLabels((labels) => labels.slice(0, -1)); setDraftPointRoles((roles) => roles.slice(0, -1)); setDraftViaInsertAfter(null) }} onClear={() => { setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftPendingSearch(null) }} onCancel={openCourseList} onSave={handleCreate} />}
        {ratingOpen && selected && <RatingForm courseId={selected.id} courseName={selected.name} onCancel={() => setRatingOpen(false)} onSave={handleRating} />}
        {course3dOpen && selected && <Course3DView course={selected} courses={courses} onClose={() => setCourse3dOpen(false)} onElevationRepaired={handleElevationRepair} />}
        {tollReportOpen && selected && <TollReportForm courseName={selected.name} onCancel={() => setTollReportOpen(false)} onSave={handleTollReport} />}
      </main>
      {notice && <div className="notice" role="status">{notice}</div>}
      {logoutConfirmOpen && <div className="modal-backdrop logout-backdrop" role="presentation">
        <section className={`modal logout-dialog ${logoutSheet.className}`} style={logoutSheet.style} role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <div className="mobile-sheet-drag-region" {...logoutSheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><h2 id="logout-title">ログアウトしますか？</h2>
          <p>ログアウトすると、コース登録や評価投稿には再度ログインが必要です。</p></div>
          <footer><button className="button secondary" onClick={() => { setLogoutConfirmOpen(false); logoutSheet.reset() }}>キャンセル</button><button className="button primary" onClick={handleLogout}>ログアウト</button></footer>
        </section>
      </div>}
      {courseManagerOpen && selected && user?.uid === selected.authorId && <CourseManageForm course={selected} onClose={() => setCourseManagerOpen(false)} onSave={handleCourseUpdate} onDelete={async (courseId) => { await handleCourseDelete(courseId); setCourseManagerOpen(false) }} />}
      {communityOpen && <CommunityPanel user={user} course={selected} onClose={() => setCommunityOpen(false)} onLogout={() => { setCommunityOpen(false); setLogoutConfirmOpen(true) }} />}
      <InstallPrompt />
    </div>
  )
}
