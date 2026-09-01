import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { MapView } from './components/MapView'
import { CourseList } from './components/CourseList'
import { CourseDetail } from './components/CourseDetail'
import { CourseForm } from './components/CourseForm'
import { RatingForm } from './components/RatingForm'
import { InstallPrompt } from './components/InstallPrompt'
import { Course3DView } from './components/Course3DView'
import { TollReportForm, type TollReport } from './components/TollReportForm'
import { RoadConditionReportForm, type RoadConditionReport } from './components/RoadConditionReportForm'
import { CommunityPanel } from './components/CommunityPanel'
import { AdminPanel } from './components/AdminPanel'
import { CourseManageForm } from './components/CourseManageForm'
import { DriveTimer } from './components/DriveTimer'
import { sampleCourses } from './data/courses'
import { addUserRating, combinedRatings, estimateSystemRatings, validateRouteQuality } from './lib/course'
import { fetchElevationProfile, type ElevationResult } from './lib/elevation'
import { auth, clearFriendPresence, completeRedirectLogin, createCourse, deleteCourse, loadCourseById, loadPublicCourses, loadUserProfile, loginWithGoogle, logout, saveFriendPresence, saveRating, saveUserProfileSettings, submitRoadConditionReport, submitTollReport, updateCourse, updateCourseElevation } from './lib/firebase'
import { routeAlongRoads } from './lib/routing'
import type { Coordinate, Course, CourseDraft, DraftPointRole, RatingSubmission, RecommendationMapAction, RecommendationMapState, SearchPreset, TollStatus, UserProfile } from './types'
import { personalizedScore } from './lib/personalization'
import { useMobileSheet } from './hooks/useMobileSheet'
import { canUseUnlimitedWaypoints, exceedsWaypointLimit, isAdministrator, WAYPOINT_LIMIT } from './lib/access'
import { courseMatchesSearch } from './lib/courseSearch'
import { geocodeJapanesePlace } from './lib/location'
import type { DriveProposal } from './lib/recommendations'
import { insertDraftStops } from './lib/draftInsertion'
import { moveDraftBlock } from './lib/draftReorder'
import { reverseDraftBlock } from './lib/draftReorder'
import { ProposalGoalDialog } from './components/ProposalGoalDialog'
import './styles.css'

type PrefectureFilter = 'すべて' | Course['prefecture']

function previewCourseFromProposal(proposal: DriveProposal): Course {
  const elevationProfile = proposal.elevationProfile
  const tags = ['提案プレビュー', proposal.source === 'openstreetmap' ? '外部道路' : '既存候補']
  const systemRatings = estimateSystemRatings(proposal.route, elevationProfile, tags)
  const lat = proposal.route[0]?.[1] ?? 35.2
  const prefecture: Course['prefecture'] = lat > 35.62 ? '東京都' : lat > 35.28 ? '神奈川県' : '静岡県'
  return {
    id: `proposal-preview-${proposal.id}`, name: proposal.name, area: proposal.area, prefecture,
    description: `保存前の自動提案コースです。${proposal.reasons.join('・')}。ルートと評価を確認してから「この候補を編集する」を選んでください。`, route: proposal.route,
    landmarks: proposal.labels.slice(1, -1).map((name, index, items) => ({ name, progress: (index + 1) / Math.max(2, items.length + 1), type: 'place' })),
    distanceKm: proposal.distanceKm, durationMin: Math.max(5, Math.round(proposal.distanceKm * 1.7)), minElevation: Math.min(...elevationProfile), maxElevation: Math.max(...elevationProfile), elevationProfile,
    elevationSource: proposal.elevationSource, ratings: systemRatings, systemRatings, ratingCount: 0,
    systemRatingSource: ['OpenStreetMap道路形状', `標高・高低差（${proposal.elevationSource}）`, '自動ルート品質検証'], systemRatingUpdatedAt: new Date().toISOString().slice(0, 10),
    tags, cautions: ['保存前の提案です。通行規制・料金・現地状況は走行前に確認してください。'], tollStatus: proposal.tollStatus, visibility: 'private', authorId: '__proposal_preview__', authorName: '峠 自動提案', updatedAt: new Date().toISOString().slice(0, 10),
  }
}

export default function App() {
  const logoutSheet = useMobileSheet()
  const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`
  const [courses, setCourses] = useState<Course[]>(sampleCourses)
  // A course is selected only after the driver chooses one (or opens a shared link).
  // Opening directly on the map must not silently focus an arbitrary sample course.
  const [selected, setSelected] = useState<Course | null>(null)
  const [search, setSearch] = useState('')
  const [prefecture, setPrefecture] = useState<PrefectureFilter>('すべて')
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [tollFilter, setTollFilter] = useState<'all' | TollStatus>('all')
  const [nearbyCenter, setNearbyCenter] = useState<{ point: Coordinate; label: string } | null>(null)
  const [nearbyQuery, setNearbyQuery] = useState('')
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(25)
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null)
  const [nearbyBusy, setNearbyBusy] = useState(false)
  const [nearbyError, setNearbyError] = useState('')
  const [presetName, setPresetName] = useState('')
  const [sort, setSort] = useState<'recommended' | 'curves' | 'elevation' | 'width' | 'personalized'>('recommended')
  const [is3d, setIs3d] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [viewerProfile, setViewerProfile] = useState<UserProfile | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [surfaceMotion, setSurfaceMotion] = useState<'idle' | 'leaving-list' | 'leaving-form' | 'entering-list' | 'entering-form'>('idle')
  const [draftRoute, setDraftRoute] = useState<Coordinate[]>([])
  const [draftPointLabels, setDraftPointLabels] = useState<string[]>([])
  const [draftPointRoles, setDraftPointRoles] = useState<DraftPointRole[]>([])
  const [draftViaInsertAfter, setDraftViaInsertAfter] = useState<number | null>(null)
  const [draftFocus, setDraftFocus] = useState<Coordinate | null>(null)
  const [draftPendingSearch, setDraftPendingSearch] = useState<{ point: Coordinate; label: string } | null>(null)
  const [recommendationMapState, setRecommendationMapState] = useState<RecommendationMapState>({ active: false, start: null, goal: null, vias: [] })
  const [recommendationMapAction, setRecommendationMapAction] = useState<RecommendationMapAction | null>(null)
  const [proposalPreviews, setProposalPreviews] = useState<Course[]>([])
  const [proposalDefinitions, setProposalDefinitions] = useState<DriveProposal[]>([])
  // A monotonically increasing request is deliberately used instead of tying
  // camera focus to the selected object identity.  Previewing the same
  // candidate twice must still refit the map after its bottom sheet changes.
  const [mapFocusRequest, setMapFocusRequest] = useState(0)
  const [proposalEditSnapshot, setProposalEditSnapshot] = useState<{ route: Coordinate[]; labels: string[]; roles: DraftPointRole[]; viaInsertAfter: number | null } | null>(null)
  const [pendingProposalAddition, setPendingProposalAddition] = useState<{ proposal: DriveProposal; placement: 'replace' | 'append'; after: number | null } | null>(null)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [course3dOpen, setCourse3dOpen] = useState(false)
  const [tollReportOpen, setTollReportOpen] = useState(false)
  const [roadReportOpen, setRoadReportOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const listSheet = useMobileSheet()
  const collapseList = listSheet.collapse
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [courseManagerOpen, setCourseManagerOpen] = useState(false)
  const [timerOpen, setTimerOpen] = useState(false)
  const surfaceTimer = useRef<number | null>(null)
  const profileDirty = useRef(false)
  const unlimitedWaypoints = canUseUnlimitedWaypoints(user)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true) })
    completeRedirectLogin().catch((error: unknown) => {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setNotice(code ? `Googleログインを完了できませんでした（${code}）。Firebase Authenticationの設定を確認してください。` : 'Googleログインを完了できませんでした。もう一度お試しください。')
    })
    return unsubscribe
  }, [])
  useEffect(() => { window.__tougeMarkReady?.() }, [])
  useEffect(() => {
    if (!authReady) return
    let cancelled = false
    loadPublicCourses(user?.uid).then((remote) => {
      if (cancelled) return
      const seedIds = new Set(remote.map((course) => course.id))
      setCourses([...remote, ...sampleCourses.filter((course) => !seedIds.has(course.id))])
    }).catch((error: unknown) => {
      if (cancelled) return
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      setNotice(code === 'permission-denied' ? 'Firebaseからコースを読み込めませんでした。Firestoreルールの公開設定を確認してください。' : 'Firebaseからコースを読み込めませんでした。通信状態を確認してください。')
    })
    return () => { cancelled = true }
  }, [authReady, user?.uid])
  useEffect(() => {
    if (!user) { setViewerProfile(null); return }
    profileDirty.current = false
    try { const cached = localStorage.getItem(`touge-profile-${user.uid}`); if (cached) setViewerProfile(JSON.parse(cached) as UserProfile) } catch { /* ignore invalid local cache */ }
    loadUserProfile(user.uid).then((profile) => {
      const remote = profile ?? { id: user.uid, displayName: user.displayName ?? 'ドライバー', bio: '', mapVisibility: 'friends' as const, followingIds: [], followerCount: 0 }
      // Keep any newer offline/local interaction that happened while the
      // Firestore request was in flight. Remote-only fields still fill gaps.
      setViewerProfile((current) => profileDirty.current && current ? { ...remote, ...current } : remote)
    }).catch(() => undefined)
  }, [user])
  useEffect(() => { if (user && viewerProfile) localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(viewerProfile)) }, [user, viewerProfile])
  useEffect(() => {
    if (!user || !viewerProfile) return
    const blocked = new Set(viewerProfile.blockedUserIds ?? [])
    const audience = viewerProfile.locationSharing?.audience ?? 'friends'
    const listIds = new Set(viewerProfile.locationSharing?.listIds ?? [])
    const selectedLists = (viewerProfile.friendLists ?? []).filter((list) => listIds.has(list.id))
    const allowedViewerIds = [...new Set((audience === 'lists' ? selectedLists.flatMap((list) => list.memberIds) : viewerProfile.followingIds).filter((id) => !blocked.has(id)))]
    const nowPlaying = viewerProfile.nowPlaying
    if (!viewerProfile.locationSharing?.enabled) {
      // Writing null is deliberate: Firestore merge writes would otherwise
      // retain the last precise location while only the music share is on.
      if (nowPlaying) void saveFriendPresence(user, { allowedViewerIds, nowPlaying, location: null })
      else void clearFriendPresence(user.uid)
      return
    }
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition((position) => void saveFriendPresence(user, { location: [position.coords.longitude, position.coords.latitude], allowedViewerIds, nowPlaying }), () => undefined, { enableHighAccuracy: true, maximumAge: 30000 })
    return () => navigator.geolocation.clearWatch(watchId)
  }, [user, viewerProfile])
  useEffect(() => {
    if (!user || !viewerProfile) return
    const globalBlocked = new Set(viewerProfile.blockedUserIds ?? [])
    const owned = courses.filter((course) => course.authorId === user.uid)
    for (const course of owned) {
      const globalBlockedViewerIds = [...globalBlocked]
      const allowedViewerIds = (course.allowedViewerIds ?? []).filter((id) => !globalBlocked.has(id))
      if (globalBlockedViewerIds.length === (course.globalBlockedViewerIds ?? []).length && globalBlockedViewerIds.every((id) => course.globalBlockedViewerIds?.includes(id)) && allowedViewerIds.length === (course.allowedViewerIds ?? []).length) continue
      const changes = { name: course.name, area: course.area, prefecture: course.prefecture, description: course.description, tags: course.tags, cautions: course.cautions, tollStatus: course.tollStatus, visibility: course.visibility, blockedViewerIds: course.blockedViewerIds ?? [], globalBlockedViewerIds, allowedViewerIds }
      void updateCourse(course.id, changes)
      setCourses((items) => items.map((item) => item.id === course.id ? { ...item, globalBlockedViewerIds, allowedViewerIds } : item))
    }
  }, [courses, user, viewerProfile])
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
    return courses
      .filter((course) => courseMatchesSearch(course, { text: search, prefecture, toll: tollFilter, center: nearbyCenter?.point, radiusKm: nearbyCenter ? nearbyRadiusKm : undefined }))
      .sort((a, b) => {
        if (sort === 'recommended') return (b.ratings.curves + b.ratings.elevation + b.ratings.width) - (a.ratings.curves + a.ratings.elevation + a.ratings.width)
        if (sort === 'personalized') return personalizedScore(b, viewerProfile?.personalization ?? {}) - personalizedScore(a, viewerProfile?.personalization ?? {})
        return b.ratings[sort] - a.ratings[sort]
      })
  }, [courses, nearbyCenter, nearbyRadiusKm, prefecture, search, sort, tollFilter, viewerProfile?.personalization])
  const mapCourses = useMemo(() => {
    const mode = viewerProfile?.mapRouteVisibility ?? 'all'
    const followed = new Set(viewerProfile?.followingIds ?? [])
    const hidden = new Set(viewerProfile?.hiddenRouteIds ?? [])
    const visible = mode === 'none' ? [] : courses.filter((course) => !hidden.has(course.id) && (mode === 'all' || (mode === 'mine' && course.authorId === user?.uid) || (mode === 'friends' && (course.authorId === user?.uid || followed.has(course.authorId)))))
    // A course picked from the list must remain visible even when the user's
    // background-map preference hides that category. Otherwise its detail can
    // open with no corresponding route on the map, which is especially
    // confusing for shared and proposal previews.
    const selectedCourse = selected ? [selected] : []
    return [...new Map([...visible, ...proposalPreviews, ...selectedCourse].map((course) => [course.id, course])).values()]
  }, [courses, proposalPreviews, selected, user?.uid, viewerProfile?.followingIds, viewerProfile?.hiddenRouteIds, viewerProfile?.mapRouteVisibility])

  function saveSearchPreset() {
    if (!user || !viewerProfile) { setNotice('プリセットの保存にはログインが必要です'); return }
    const name = presetName.trim()
    if (!name) return
    const existing = viewerProfile.searchPresets ?? []
    if (existing.length >= 5) { setNotice('検索プリセットは5件までです'); return }
    const preset: SearchPreset = { id: crypto.randomUUID(), name, prefecture, toll: tollFilter, radiusKm: nearbyRadiusKm, sort }
    const next = { ...viewerProfile, searchPresets: [...existing, preset] }
    profileDirty.current = true; setViewerProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next)); setPresetName('')
    void saveUserProfileSettings(user, { searchPresets: next.searchPresets }).catch(() => setNotice('端末には保存しました。接続回復後にもう一度保存してください。'))
    setNotice('検索条件を保存しました')
  }
  function removeSearchPreset(id: string) {
    if (!user || !viewerProfile) return
    const next = { ...viewerProfile, searchPresets: (viewerProfile.searchPresets ?? []).filter((item) => item.id !== id) }
    profileDirty.current = true; setViewerProfile(next); localStorage.setItem(`touge-profile-${user.uid}`, JSON.stringify(next))
    void saveUserProfileSettings(user, { searchPresets: next.searchPresets }).catch(() => setNotice('端末では削除しました。接続回復後にもう一度保存してください。'))
    setNotice('検索プリセットを削除しました')
  }
  function applySearchPreset(id: string) {
    const preset = viewerProfile?.searchPresets?.find((item) => item.id === id); if (!preset) return
    setPrefecture(preset.prefecture); setTollFilter(preset.toll); setNearbyRadiusKm(preset.radiusKm); setSort(preset.sort)
  }

  const selectCourse = useCallback((course: Course) => {
    setSelected(course)
    // Every selection—including reopening the same proposal—gets a fresh map
    // camera request. This is also used by ordinary courses for consistency.
    setMapFocusRequest((request) => request + 1)
    collapseList()
  }, [collapseList])
  const addPoint = useCallback((point: Coordinate, label = '地図指定', requestedRole: 'via' | 'goal' = 'via', requestedInsertAfter: number | null = null) => {
    // Keep all three parallel arrays in the same operation. A new via point is
    // placed before an existing goal; choosing a new goal promotes the old one
    // to a via point and makes the newly selected location the route endpoint.
    const next = insertDraftStops({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles }, [point], [label], requestedRole, requestedInsertAfter)
    setDraftRoute(next.route); setDraftPointLabels(next.labels); setDraftPointRoles(next.roles)
    setDraftViaInsertAfter(null)
  }, [draftRoute, draftPointLabels, draftPointRoles])
  const incorporateCourse = useCallback((course: Course, requestedInsertAfter: number | null = null) => {
    const sampleCount = Math.min(12, Math.max(3, course.route.length))
    const points = Array.from({ length: sampleCount }, (_, index) => course.route[Math.round((index / Math.max(1, sampleCount - 1)) * (course.route.length - 1))])
    const labels = points.map((_, index) => index === 0 ? `${course.name}・始点` : index === points.length - 1 ? `${course.name}・終点` : `${course.name}・経由地`)
    const next = insertDraftStops({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles }, points, labels, 'course', requestedInsertAfter)
    setDraftRoute(next.route); setDraftPointLabels(next.labels); setDraftPointRoles(next.roles)
    setDraftViaInsertAfter(null)
    setDraftFocus(points.at(-1) ?? null)
    setDraftPendingSearch(null)
  }, [draftRoute, draftPointLabels, draftPointRoles])
  const setFinalPointAsGoal = useCallback(() => {
    setDraftPointRoles((roles) => roles.map((role, index) => index === roles.length - 1 ? 'goal' : role === 'goal' ? 'via' : role))
  }, [])
  const reverseDraftRoute = useCallback(() => {
    setDraftRoute((route) => {
      const reversed = [...route].reverse()
      setDraftFocus(reversed[0] ?? null)
      return reversed
    })
    setDraftPointLabels((labels) => [...labels].reverse())
    setDraftPointRoles((roles) => [...roles].reverse().map((role) => role === 'start' ? 'goal' : role === 'goal' ? 'start' : 'via'))
    setDraftViaInsertAfter(null)
    setDraftPendingSearch(null)
  }, [])
  const moveRouteBlock = useCallback((from: number, count: number, to: number) => {
    const next = moveDraftBlock({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles }, from, count, to)
    setDraftRoute(next.route)
    setDraftPointLabels(next.labels)
    setDraftPointRoles(next.roles)
    setDraftViaInsertAfter(null)
  }, [draftRoute, draftPointLabels, draftPointRoles])
  const reverseRouteBlock = useCallback((start: number, count: number) => {
    const next = reverseDraftBlock({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles }, start, count)
    setDraftRoute(next.route)
    setDraftPointLabels(next.labels)
    setDraftPointRoles(next.roles)
    setDraftViaInsertAfter(null)
    setDraftFocus(next.route[start] ?? null)
  }, [draftRoute, draftPointLabels, draftPointRoles])
  function resetListSheet() {
    listSheet.reset()
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
    setProposalPreviews([]); setProposalDefinitions([]); setProposalEditSnapshot(null); setRecommendationMapState({ active: false, start: null, goal: null, vias: [] }); setRecommendationMapAction(null); setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftFocus(null); setDraftPendingSearch(null)
    resetListSheet()
    finishSurfaceMotion('list')
  }


  async function findNearbyCourses(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!nearbyQuery.trim()) return
    setNearbyBusy(true); setNearbyError('')
    try {
      const result = await geocodeJapanesePlace(nearbyQuery)
      setNearbyCenter({ point: result.coordinate, label: result.label })
      setDraftFocus(result.coordinate)
      setNearbyQuery('')
    } catch (caught) { setNearbyError(caught instanceof Error ? caught.message : '場所を検索できませんでした') }
    finally { setNearbyBusy(false) }
  }

  function useCurrentLocationForSearch() {
    if (!navigator.geolocation) { setNearbyError('この端末では現在地を取得できません'); return }
    setNearbyBusy(true); setNearbyError('')
    navigator.geolocation.getCurrentPosition((position) => {
      const point: Coordinate = [position.coords.longitude, position.coords.latitude]
      setCurrentLocation(point); setNearbyCenter({ point, label: '現在地' }); setDraftFocus(point); setNearbyBusy(false)
    }, () => { setNearbyError('現在地を取得できませんでした。位置情報の許可を確認してください。'); setNearbyBusy(false) }, { enableHighAccuracy: true, timeout: 10000 })
  }

  function handleUseProposal(proposal: DriveProposal, placement: 'replace' | 'append' = draftRoute.length ? 'append' : 'replace', requestedInsertAfter: number | null = null) {
    setPendingProposalAddition({ proposal, placement, after: requestedInsertAfter })
  }

  function confirmProposalAddition(makeGoal: boolean) {
    if (!pendingProposalAddition) return
    const { proposal, placement, after: requestedInsertAfter } = pendingProposalAddition
    // Preview geometry and editable stops have different jobs. Rendering uses
    // every road vertex; the builder exposes only a compact set of anchors.
    const proposalRoute = proposal.waypoints ?? proposal.route
    const proposalLabels = proposalRoute.map((_, index) => index === 0 ? `${proposal.name}・始点` : index === proposalRoute.length - 1 ? `${proposal.name}・終点` : `${proposal.name}・経由地${proposal.labels[index] ? `（${proposal.labels[index]}）` : ''}`)
    if (placement === 'replace') {
      setProposalEditSnapshot((snapshot) => snapshot ?? {
        route: draftRoute,
        labels: draftPointLabels,
        roles: draftPointRoles,
        viaInsertAfter: draftViaInsertAfter,
      })
      setDraftRoute(proposalRoute)
      setDraftPointLabels(proposalLabels)
      setDraftPointRoles(proposalRoute.map((_, index) => index === 0 ? 'start' : makeGoal && index === proposalRoute.length - 1 ? 'goal' : 'via'))
    } else {
      setProposalEditSnapshot({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles, viaInsertAfter: draftViaInsertAfter })
      const next = insertDraftStops({ route: draftRoute, labels: draftPointLabels, roles: draftPointRoles }, proposalRoute, proposalLabels, makeGoal ? 'goal' : 'proposal', requestedInsertAfter)
      setDraftRoute(next.route); setDraftPointLabels(next.labels); setDraftPointRoles(next.roles)
    }
    setDraftViaInsertAfter(null)
    setDraftFocus(proposalRoute.at(-1) ?? null)
    setDraftPendingSearch(null)
    setPendingProposalAddition(null)
    setSelected(null)
    setNotice(makeGoal ? '提案区間を追加し、その終点をゴールにしました。' : '提案区間を経由地として追加しました。ゴール設定は変更していません。')
  }

  function undoProposalEdit() {
    if (!proposalEditSnapshot) return
    setDraftRoute(proposalEditSnapshot.route)
    setDraftPointLabels(proposalEditSnapshot.labels)
    setDraftPointRoles(proposalEditSnapshot.roles)
    setDraftViaInsertAfter(proposalEditSnapshot.viaInsertAfter)
    setDraftFocus(proposalEditSnapshot.route[0] ?? null)
    setDraftPendingSearch(null)
    setProposalEditSnapshot(null)
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
      setSelected(null); setProposalPreviews([]); setProposalDefinitions([]); setProposalEditSnapshot(null); setRecommendationMapState({ active: false, start: null, goal: null, vias: [] }); setRecommendationMapAction(null); setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftFocus(null); setDraftPendingSearch(null)
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
      blockedViewerIds: draft.blockedViewerIds ?? [],
      globalBlockedViewerIds: viewerProfile?.blockedUserIds ?? [],
      allowedViewerIds: (draft.allowedViewerIds ?? []).filter((id) => !(viewerProfile?.blockedUserIds ?? []).includes(id) && !(draft.blockedViewerIds ?? []).includes(id)),
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

  async function handleRoadConditionReport(report: RoadConditionReport) {
    if (!selected) return
    if (!user) { await handleLogin(); if (!auth.currentUser) throw new Error('Login required') }
    await submitRoadConditionReport(selected.id, report, auth.currentUser!)
    setNotice('道路状況を受け付けました。確認後に反映します。')
  }

  async function handleRating(rating: RatingSubmission) {
    if (!user) { await handleLogin(); throw new Error('Login required') }
    await saveRating(rating, user)
    setCourses((items) => items.map((course) => course.id === rating.courseId ? addUserRating(course, rating) : course))
    setSelected((course) => course && course.id === rating.courseId ? addUserRating(course, rating) : course)
    setNotice('評価を投稿しました。集計への反映には時間がかかる場合があります。')
  }

  async function handleCourseUpdate(courseId: string, changes: Pick<Course, 'name' | 'area' | 'prefecture' | 'description' | 'tags' | 'cautions' | 'tollStatus' | 'visibility' | 'allowedViewerIds' | 'blockedViewerIds'>) {
    const current = courses.find((course) => course.id === courseId)
    if (!current || current.authorId !== auth.currentUser?.uid) throw new Error('Not authorized')
    const blocked = new Set([...(viewerProfile?.blockedUserIds ?? []), ...(changes.blockedViewerIds ?? [])])
    const safeChanges = { ...changes, blockedViewerIds: changes.blockedViewerIds ?? [], globalBlockedViewerIds: viewerProfile?.blockedUserIds ?? current.globalBlockedViewerIds ?? [], allowedViewerIds: (changes.allowedViewerIds ?? []).filter((id) => !blocked.has(id)) }
    await updateCourse(courseId, safeChanges)
    const updated = { ...current, ...safeChanges, updatedAt: new Date().toISOString().slice(0, 10) }
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
  const selectedPreviewIndex = selected ? proposalPreviews.findIndex((course) => course.id === selected.id) : -1

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { openCourseList(); setSelected(null) }} aria-label="峠 ホーム">
          <img src={asset('icons/icon.svg')} alt="" /><span><b>峠</b><small>TOUGE EXPLORER</small></span>
        </button>
        <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="コース名・地名・タグ・特徴で検索" aria-label="コースを検索" /></div>
        <div className="top-actions">
          <button className="new-route" onClick={openCreateFlow}><span>＋</span>コース登録</button>
          {user ? <button className="user-button" onClick={() => setCommunityOpen(true)} title="プロフィールとコミュニティ" aria-label="プロフィールとコミュニティ">{user.photoURL ? <img src={user.photoURL} alt="" /> : user.displayName?.slice(0, 1)}<span>{user.displayName ?? 'アカウント'}</span></button> : <button className="login-button" onClick={handleLogin} disabled={authBusy}>{authBusy ? '接続中…' : 'ログイン'}</button>}
        </div>
      </header>

      <main>
        <MapView courses={mapCourses} selected={selected} previewCourseIds={proposalPreviews.map((course) => course.id)} focusRequest={mapFocusRequest} is3d={is3d} drawing={drawing} draftRoute={draftRoute} draftLabels={draftPointLabels} draftRoles={draftPointRoles} viaInsertAfter={draftViaInsertAfter} focusPoint={draftFocus} pendingSearchPoint={draftPendingSearch?.point ?? null} pendingSearchLabel={draftPendingSearch?.label ?? ''} recommendationMapState={recommendationMapState} currentLocation={currentLocation} searchCenter={nearbyCenter?.point} searchRadiusKm={nearbyCenter ? nearbyRadiusKm : undefined} onCurrentLocationChange={setCurrentLocation} onSelect={selectCourse} onRecommendationMapAction={(action) => setRecommendationMapAction({ ...action, id: Date.now() })} onAddPoint={(point, label, role, insertAfter) => { addPoint(point, label, role, insertAfter); setDraftFocus(point); setDraftPendingSearch(null) }} onMovePoint={(index, point) => setDraftRoute((route) => route.map((item, itemIndex) => itemIndex === index ? point : item))} />
        <section data-map-occlusion="bottom-sheet" className={`explore-panel open ${listSheet.className} ${drawing ? 'drawing' : ''} ${selected ? 'covered-by-detail' : ''} ${surfaceMotion === 'leaving-list' ? 'surface-leaving' : surfaceMotion === 'entering-list' ? 'surface-entering' : ''}`} style={drawing ? undefined : listSheet.style} aria-label="コースを探す" {...listSheet.dragProps}>
          <div className="explore-panel-top">
            <div className="explore-drag-handle" role="button" tabIndex={0} aria-label="上部全体をタップまたはドラッグしてコース一覧を操作" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); listSheet.openResting() } }} />
          </div>
          <CourseList courses={filtered} selectedId={selected?.id} onSelect={selectCourse} scrollProps={listSheet.scrollProps} header={<div className="course-list-drag-area">
            <div className="panel-heading"><div><p className="eyebrow">DISCOVER KANTO</p><h1>走りたい道を探す</h1></div></div>
            <div className="list-toolbar">
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="並び順"><option value="recommended">おすすめ順</option><option value="personalized">パーソナライズ順</option><option value="curves">カーブ評価順</option><option value="elevation">高低差評価順</option><option value="width">道幅評価順</option></select>
              <button type="button" className={`advanced-filter-toggle ${advancedFiltersOpen ? 'active' : ''}`} onClick={() => setAdvancedFiltersOpen((value) => !value)} aria-expanded={advancedFiltersOpen} aria-controls="advanced-course-filters">詳細検索 <span aria-hidden="true">{advancedFiltersOpen ? '−' : '+'}</span></button>
            </div>
            <div id="advanced-course-filters" className={`advanced-filters ${advancedFiltersOpen ? 'open' : ''}`} aria-hidden={!advancedFiltersOpen} inert={!advancedFiltersOpen}><div className="advanced-filters-inner">
              <div className="filter-row">
                <select value={prefecture} onChange={(event) => setPrefecture(event.target.value as PrefectureFilter)} aria-label="都県"><option>すべて</option><option>東京都</option><option>神奈川県</option><option>静岡県</option></select>
                <select value={tollFilter} onChange={(event) => setTollFilter(event.target.value as 'all' | TollStatus)} aria-label="料金区分"><option value="all">料金すべて</option><option value="free">無料</option><option value="toll">有料</option><option value="conditional">条件付き無料</option><option value="mixed">有料・無料混在</option><option value="unknown">料金情報未確認</option></select>
              </div>
              <div className="filter-row course-extra-filters">
                <select value={nearbyRadiusKm} onChange={(event) => setNearbyRadiusKm(Number(event.target.value))} disabled={!nearbyCenter} aria-label="検索半径"><option value={5}>半径5km</option><option value={10}>半径10km</option><option value={25}>半径25km</option><option value={50}>半径50km</option><option value={100}>半径100km</option></select>
                <span className="nearby-filter-caption">指定地点の近くから探す</span>
              </div>
              <form className="nearby-course-search" onSubmit={findNearbyCourses}><input value={nearbyQuery} onChange={(event) => setNearbyQuery(event.target.value)} placeholder="地名・住所から近くのコースを探す" aria-label="近くのコースを探す場所" /><button type="submit" disabled={nearbyBusy}>{nearbyBusy ? '検索中…' : '近くを探す'}</button><button type="button" onClick={useCurrentLocationForSearch} disabled={nearbyBusy}>現在地</button></form>
              {nearbyCenter && <div className="active-nearby-filter"><span>{nearbyCenter.label}から{nearbyRadiusKm}km以内</span><button type="button" onClick={() => setNearbyCenter(null)} aria-label="位置条件を解除">×</button></div>}
              {user && <section className="search-presets" aria-label="検索プリセット"><div className="preset-row"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} maxLength={24} placeholder="プリセット名" aria-label="新しい検索プリセット名" /><button type="button" disabled={!presetName.trim() || (viewerProfile?.searchPresets?.length ?? 0) >= 5} onClick={saveSearchPreset}>条件を保存</button></div>{(viewerProfile?.searchPresets?.length ?? 0) > 0 && <div className="preset-chips">{viewerProfile!.searchPresets!.map((preset) => <span key={preset.id}><button type="button" onClick={() => applySearchPreset(preset.id)}>{preset.name}</button><button type="button" onClick={() => removeSearchPreset(preset.id)} aria-label={`${preset.name}を削除`}>×</button></span>)}</div>}<small>{viewerProfile?.searchPresets?.length ?? 0} / 5件</small></section>}
              {nearbyError && <p className="filter-error" role="alert">{nearbyError}</p>}
            </div></div>
          </div>} />
        </section>

        <div className="map-tools">
          <button className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)} aria-pressed={is3d}><span>▰</span>{is3d ? '2Dに戻す' : '3D地形'}</button>
        </div>

        {selected && <CourseDetail
          course={selected}
          onClose={() => setSelected(null)}
          onBack={() => { setSelected(null); resetListSheet() }}
          onRate={() => setRatingOpen(true)} onShare={shareCourse} onOpen3d={() => setCourse3dOpen(true)}
          onReportToll={() => setTollReportOpen(true)} onReportRoad={() => setRoadReportOpen(true)}
          onCommunity={() => setCommunityOpen(true)} onOpenTimer={() => setTimerOpen(true)}
          canManageCourse={Boolean(user && selected.authorId === user.uid)} onManageCourse={() => setCourseManagerOpen(true)}
          mapHidden={Boolean(viewerProfile?.hiddenRouteIds?.includes(selected.id))}
          onToggleMapRoute={user && viewerProfile ? async () => {
            const hidden = new Set(viewerProfile.hiddenRouteIds ?? [])
            if (hidden.has(selected.id)) hidden.delete(selected.id); else hidden.add(selected.id)
            const next = { ...viewerProfile, hiddenRouteIds: [...hidden] }
            profileDirty.current = true; setViewerProfile(next); await saveUserProfileSettings(user, { hiddenRouteIds: next.hiddenRouteIds })
          } : undefined}
          isPreview={selected.authorId === '__proposal_preview__'}
          previewNavigation={selectedPreviewIndex >= 0 ? { index: selectedPreviewIndex, total: proposalPreviews.length, onPrevious: () => { const next = proposalPreviews[selectedPreviewIndex - 1]; if (next) selectCourse(next) }, onNext: () => { const next = proposalPreviews[selectedPreviewIndex + 1]; if (next) selectCourse(next) }, onReturn: () => setSelected(null) } : undefined}
          onEditPreview={() => { const id = selected.id.replace('proposal-preview-', ''); const proposal = proposalDefinitions.find((item) => item.id === id); if (proposal) handleUseProposal(proposal) }}
        />}
        {drawing && <CourseForm transitionState={surfaceMotion === 'leaving-form' ? 'leaving' : surfaceMotion === 'entering-form' ? 'entering' : 'idle'} previewActive={selected?.authorId === '__proposal_preview__'} route={draftRoute} pointLabels={draftPointLabels} pointRoles={draftPointRoles} viaInsertAfter={draftViaInsertAfter} courses={courses} canUseUnlimitedWaypoints={unlimitedWaypoints} hasProposalEditSnapshot={Boolean(proposalEditSnapshot)} onAddPoint={(point, label, role, insertAfter) => { addPoint(point, label, role, insertAfter); setDraftFocus(point); setDraftPendingSearch(null) }} onIncorporateCourse={incorporateCourse} onFocusPoint={setDraftFocus} onCurrentLocationChange={setCurrentLocation} onPendingPointChange={(point, label = '') => setDraftPendingSearch(point ? { point, label } : null)} recommendationMapAction={recommendationMapAction} onRecommendationMapStateChange={setRecommendationMapState} onUseProposal={handleUseProposal} onUndoProposalEdit={undoProposalEdit} onSetProposalPreviews={(proposals) => { setProposalEditSnapshot(null); setProposalDefinitions(proposals); setProposalPreviews(proposals.map(previewCourseFromProposal)) }} onOpenProposalPreview={(proposalId) => { const proposal = proposalDefinitions.find((item) => item.id === proposalId); if (proposal) selectCourse(previewCourseFromProposal(proposal)) }} onRemovePoint={(index) => { setDraftRoute((route) => route.filter((_, pointIndex) => pointIndex !== index)); setDraftPointLabels((labels) => labels.filter((_, labelIndex) => labelIndex !== index)); setDraftPointRoles((roles) => roles.filter((_, roleIndex) => roleIndex !== index)); setDraftViaInsertAfter(null) }} onSetFinalPointAsGoal={setFinalPointAsGoal} onReverseRoute={reverseDraftRoute} onMoveRouteBlock={moveRouteBlock} onReverseRouteBlock={reverseRouteBlock} onChooseViaInsertion={setDraftViaInsertAfter} onUndo={() => { setDraftRoute((route) => route.slice(0, -1)); setDraftPointLabels((labels) => labels.slice(0, -1)); setDraftPointRoles((roles) => roles.slice(0, -1)); setDraftViaInsertAfter(null) }} onClear={() => { setDraftRoute([]); setDraftPointLabels([]); setDraftPointRoles([]); setDraftViaInsertAfter(null); setDraftPendingSearch(null) }} onCancel={openCourseList} onSave={handleCreate} />}
        {ratingOpen && selected && <RatingForm courseId={selected.id} courseName={selected.name} onCancel={() => setRatingOpen(false)} onSave={handleRating} />}
        {course3dOpen && selected && <Course3DView course={selected} onClose={() => setCourse3dOpen(false)} onElevationRepaired={handleElevationRepair} />}
        {timerOpen && selected && <DriveTimer course={selected} onClose={() => setTimerOpen(false)} />}
        {tollReportOpen && selected && <TollReportForm courseName={selected.name} onCancel={() => setTollReportOpen(false)} onSave={handleTollReport} />}
        {roadReportOpen && selected && <RoadConditionReportForm courseName={selected.name} onCancel={() => setRoadReportOpen(false)} onSave={handleRoadConditionReport} />}
      </main>
      {pendingProposalAddition && <ProposalGoalDialog name={pendingProposalAddition.proposal.name} hasGoal={draftPointRoles.includes('goal')} onChoose={confirmProposalAddition} onCancel={() => setPendingProposalAddition(null)} />}
      {notice && <div className="notice" role="status">{notice}</div>}
      {logoutConfirmOpen && <div className="modal-backdrop logout-backdrop" role="presentation">
        <section className={`modal logout-dialog ${logoutSheet.className}`} style={logoutSheet.style} role="dialog" aria-modal="true" aria-labelledby="logout-title" {...logoutSheet.dragProps}>
          <div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><h2 id="logout-title">ログアウトしますか？</h2>
          <p>ログアウトすると、コース登録や評価投稿には再度ログインが必要です。</p></div>
          <footer><button className="button secondary" onClick={() => { setLogoutConfirmOpen(false); logoutSheet.reset() }}>キャンセル</button><button className="button primary" onClick={handleLogout}>ログアウト</button></footer>
        </section>
      </div>}
      {courseManagerOpen && selected && user?.uid === selected.authorId && <CourseManageForm course={selected} profile={viewerProfile} onClose={() => setCourseManagerOpen(false)} onSave={handleCourseUpdate} onDelete={async (courseId) => { await handleCourseDelete(courseId); setCourseManagerOpen(false) }} />}
      {communityOpen && <CommunityPanel user={user} course={selected} onProfileSaved={(profile) => { profileDirty.current = true; setViewerProfile(profile) }} onClose={() => setCommunityOpen(false)} onLogout={() => { setCommunityOpen(false); setLogoutConfirmOpen(true) }} onAdminOpen={isAdministrator(user) ? () => { setCommunityOpen(false); setAdminOpen(true) } : undefined} />}
      {adminOpen && user && isAdministrator(user) && <AdminPanel user={user} courses={courses} onClose={() => setAdminOpen(false)} />}
      <InstallPrompt />
    </div>
  )
}
