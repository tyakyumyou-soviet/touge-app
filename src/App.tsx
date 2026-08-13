import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { MapView } from './components/MapView'
import { CourseList } from './components/CourseList'
import { CourseDetail } from './components/CourseDetail'
import { CourseForm } from './components/CourseForm'
import { RatingForm } from './components/RatingForm'
import { InstallPrompt } from './components/InstallPrompt'
import { Course3DView } from './components/Course3DView'
import { TollReportForm, type TollReport } from './components/TollReportForm'
import { sampleCourses } from './data/courses'
import { addUserRating, approximateElevationProfile, estimateSystemRatings } from './lib/course'
import { auth, completeRedirectLogin, createCourse, loadCourseById, loadPublicCourses, loginWithGoogle, logout, saveRating, submitTollReport } from './lib/firebase'
import { routeAlongRoads } from './lib/routing'
import type { Coordinate, Course, CourseDraft, RatingSubmission } from './types'
import './styles.css'

type PrefectureFilter = 'すべて' | Course['prefecture']

export default function App() {
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
  const [draftRoute, setDraftRoute] = useState<Coordinate[]>([])
  const [ratingOpen, setRatingOpen] = useState(false)
  const [course3dOpen, setCourse3dOpen] = useState(false)
  const [tollReportOpen, setTollReportOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [listOpen, setListOpen] = useState(true)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)

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
    loadPublicCourses().then((remote) => {
      if (remote.length) {
        const seedIds = new Set(remote.map((course) => course.id))
        setCourses([...remote, ...sampleCourses.filter((course) => !seedIds.has(course.id))])
      }
    }).catch(() => setNotice('オフラインモード: 保存済みのおすすめコースを表示しています'))
  }, [])
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

  const selectCourse = useCallback((course: Course) => { setSelected(course); setListOpen(false) }, [])
  const addPoint = useCallback((point: Coordinate) => setDraftRoute((route) => [...route, point]), [])

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
      setNotice('ログアウトしました')
    } catch {
      setNotice('ログアウトできませんでした。もう一度お試しください。')
    }
  }

  async function startDrawing() {
    if (!user) { await handleLogin(); if (!auth.currentUser) return }
    setSelected(null); setDraftRoute([]); setDrawing(true); setListOpen(false)
  }

  async function handleCreate(draft: CourseDraft) {
    const activeUser = auth.currentUser
    if (!activeUser) throw new Error('Authentication required')
    const routed = await routeAlongRoads(draft.route)
    const elevation = approximateElevationProfile(routed.route)
    const systemRatings = estimateSystemRatings(routed.route, elevation, draft.tags)
    const data: Omit<Course, 'id'> = {
      ...draft,
      route: routed.route,
      distanceKm: routed.distanceKm,
      durationMin: routed.durationMin,
      minElevation: Math.min(...elevation),
      maxElevation: Math.max(...elevation),
      elevationProfile: elevation,
      ratings: systemRatings,
      systemRatings,
      ratingCount: 0,
      systemRatingSource: ['道路形状・曲率（道路ルーティング）', '標高・高低差（地形データ）', '登録タグ・公開情報'],
      systemRatingUpdatedAt: new Date().toISOString().slice(0, 10),
      authorId: activeUser.uid,
      authorName: activeUser.displayName ?? 'ドライバー',
      updatedAt: new Date().toISOString().slice(0, 10),
    }
    const id = await createCourse(data)
    const created = { id, ...data }
    setCourses((items) => [created, ...items]); setSelected(created); setDrawing(false); setDraftRoute([]); setNotice('コースを保存しました')
  }

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

  async function shareCourse() {
    if (!selected) return
    const url = `${location.origin}${location.pathname}?course=${selected.id}`
    if (navigator.share) await navigator.share({ title: `${selected.name} | 峠`, text: selected.description, url })
    else { await navigator.clipboard.writeText(url); setNotice('共有リンクをコピーしました') }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setListOpen(true); setSelected(null) }} aria-label="峠 ホーム">
          <img src={asset('icons/icon.svg')} alt="" /><span><b>峠</b><small>TOUGE EXPLORER</small></span>
        </button>
        <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="峠・エリア・特徴で検索" aria-label="コースを検索" /></div>
        <div className="top-actions">
          <button className="new-route" onClick={startDrawing}><span>＋</span>コース登録</button>
          {user ? <button className="user-button" onClick={() => setLogoutConfirmOpen(true)} title="ログアウトメニューを開く" aria-label="ログアウトメニューを開く">{user.photoURL ? <img src={user.photoURL} alt="" /> : user.displayName?.slice(0, 1)}<span>{user.displayName ?? 'アカウント'}</span></button> : <button className="login-button" onClick={handleLogin} disabled={authBusy}>{authBusy ? '接続中…' : 'ログイン'}</button>}
        </div>
      </header>

      <main>
        <MapView courses={filtered} selected={selected} is3d={is3d} drawing={drawing} draftRoute={draftRoute} onSelect={selectCourse} onAddPoint={addPoint} />
        <section className={`explore-panel ${listOpen ? 'open' : ''}`} aria-label="コースを探す">
          <div className="panel-heading"><div><p className="eyebrow">DISCOVER KANTO</p><h1>走りたい道を探す</h1></div><button className="mobile-close icon-button" onClick={() => setListOpen(false)}>×</button></div>
          <div className="filter-row">
            <select value={prefecture} onChange={(event) => setPrefecture(event.target.value as PrefectureFilter)} aria-label="都県"><option>すべて</option><option>東京都</option><option>神奈川県</option><option>静岡県</option></select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="並び順"><option value="recommended">おすすめ順</option><option value="curves">カーブ評価順</option><option value="elevation">高低差評価順</option><option value="width">道幅評価順</option></select>
          </div>
          <div className="result-count"><span>{filtered.length} ROUTES</span><small>東京・神奈川・静岡</small></div>
          <CourseList courses={filtered} selectedId={selected?.id} onSelect={selectCourse} />
        </section>

        <div className="map-tools">
          <button className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)} aria-pressed={is3d}><span>▰</span>{is3d ? '2Dに戻す' : '3D地形'}</button>
          <button className="mobile-list" onClick={() => setListOpen(true)}>☰ コース一覧</button>
        </div>

        {selected && <CourseDetail course={selected} onClose={() => setSelected(null)} onRate={() => setRatingOpen(true)} onShare={shareCourse} onOpen3d={() => setCourse3dOpen(true)} onReportToll={() => setTollReportOpen(true)} />}
        {drawing && <CourseForm route={draftRoute} onUndo={() => setDraftRoute((route) => route.slice(0, -1))} onCancel={() => { setDrawing(false); setDraftRoute([]) }} onSave={handleCreate} />}
        {ratingOpen && selected && <RatingForm courseId={selected.id} courseName={selected.name} onCancel={() => setRatingOpen(false)} onSave={handleRating} />}
        {course3dOpen && selected && <Course3DView course={selected} onClose={() => setCourse3dOpen(false)} />}
        {tollReportOpen && selected && <TollReportForm courseName={selected.name} onCancel={() => setTollReportOpen(false)} onSave={handleTollReport} />}
      </main>
      {notice && <div className="notice" role="status">{notice}</div>}
      {logoutConfirmOpen && <div className="modal-backdrop logout-backdrop" role="presentation">
        <section className="modal logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <h2 id="logout-title">ログアウトしますか？</h2>
          <p>ログアウトすると、コース登録や評価投稿には再度ログインが必要です。</p>
          <footer><button className="button secondary" onClick={() => setLogoutConfirmOpen(false)}>キャンセル</button><button className="button primary" onClick={handleLogout}>ログアウト</button></footer>
        </section>
      </div>}
      <InstallPrompt />
    </div>
  )
}
