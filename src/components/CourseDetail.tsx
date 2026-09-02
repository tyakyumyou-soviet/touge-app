import { useEffect, useState } from 'react'
import type { Course } from '../types'
import { combinedRatings, googleMapsUrl, overallRating, systemRatingsFor, userRatingCountFor } from '../lib/course'
import { courseTollStatus, tollStatusLabels } from '../lib/toll'
import { subscribeLiveRoadInfo } from '../lib/firebase'
import { fetchCurrentWeather, type CurrentWeather } from '../lib/liveWeather'
import type { LiveRoadInfo } from '../types'
import { ElevationChart } from './ElevationChart'
import { RatingBars } from './RatingBars'
import { useMobileSheet } from '../hooks/useMobileSheet'

interface Props {
  course: Course
  onClose: () => void
  onBack: () => void
  onRate: () => void
  onShare: () => void
  onOpen3d: () => void
  onReportToll: () => void
  onReportRoad: () => void
  onCommunity: () => void
  canManageCourse: boolean
  onManageCourse: () => void
  mapHidden?: boolean
  onToggleMapRoute?: () => void
  onOpenTimer?: () => void
  isPreview?: boolean
  onEditPreview?: () => void
  onReversePreview?: () => void
  previewNavigation?: { index: number; total: number; onPrevious: () => void; onNext: () => void; onReturn: () => void }
}

export function CourseDetail({ course, onClose, onBack, onRate, onShare, onOpen3d, onReportToll, onReportRoad, onCommunity, canManageCourse, onManageCourse, mapHidden, onToggleMapRoute, onOpenTimer, isPreview = false, onEditPreview, onReversePreview, previewNavigation }: Props) {
  const sheet = useMobileSheet()
  const [navigationReversed, setNavigationReversed] = useState(false)
  const [liveInfo, setLiveInfo] = useState<LiveRoadInfo | null>(null)
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const systemRatings = systemRatingsFor(course)
  const mergedRatings = combinedRatings(course)
  const userCount = userRatingCountFor(course)
  const tollStatus = courseTollStatus(course)
  useEffect(() => isPreview ? undefined : subscribeLiveRoadInfo(course.id, setLiveInfo), [course.id, isPreview])
  useEffect(() => { setNavigationReversed(false) }, [course.id])
  useEffect(() => {
    let cancelled = false
    const midpoint = course.route[Math.floor(course.route.length / 2)] ?? course.route[0]
    if (!midpoint) return
    fetchCurrentWeather(midpoint).then((value) => { if (!cancelled) setWeather(value) }).catch(() => { if (!cancelled) setWeather(null) })
    return () => { cancelled = true }
  }, [course.id, course.route])

  return (
    <article data-map-occlusion="bottom-sheet" className={`detail-panel ${isPreview ? 'proposal-preview-detail' : ''} ${sheet.className}`} style={sheet.style} aria-label={`${course.name}の詳細`}>
      <div className="detail-sheet-top" {...sheet.dragProps} onClick={sheet.expandOnTap}>
        <div className="drag-handle" aria-label="下へスワイプして詳細を閉じる。上へスワイプして詳細を広げる" />
      </div>
      <div className="detail-scroll" data-sheet-scroll {...sheet.scrollProps}>
        <header className="detail-header">
          <div><p className="eyebrow">{course.prefecture} · {course.area}</p><h2>{course.name}</h2></div>
          <div className="detail-header-actions">
            {isPreview ? (
              <button className="icon-button back-button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onBack() }} aria-label="候補一覧へ戻る">←</button>
            ) : (
              <>
                <button className="icon-button back-button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onBack() }} aria-label="コース一覧へ戻る">←</button>
                <button className="icon-button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose() }} aria-label="詳細を閉じる">×</button>
              </>
            )}
          </div>
        </header>
        {isPreview && <section className="proposal-preview-actions" aria-label="提案候補の操作">{previewNavigation && <div className="preview-navigation"><button type="button" onClick={previewNavigation.onPrevious} disabled={previewNavigation.index === 0}>← 前の候補</button><button type="button" onClick={previewNavigation.onReturn}>候補一覧へ</button><button type="button" onClick={previewNavigation.onNext} disabled={previewNavigation.index === previewNavigation.total - 1}>次の候補 →</button></div>}{onEditPreview && <button type="button" className="edit-preview-button" onClick={onEditPreview}>この候補を編集する</button>}</section>}
        <div className="hero-metrics">
          <div><strong>{course.distanceKm}</strong><span>km</span></div>
          <div><strong>{course.durationMin}</strong><span>分</span></div>
          <div><strong>{course.maxElevation - course.minElevation}</strong><span>m 高低差</span></div>
          <div className="score"><strong>{overallRating(mergedRatings)}</strong><span>総合評価</span></div>
        </div>
        <div className="tag-row"><span className={`toll-chip ${tollStatus}`}>{tollStatusLabels[tollStatus]}</span>{course.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="description">{course.description}</p>
        <button className="three-d-cta" onClick={onOpen3d}><span>3D</span><div><strong>立体コースビュー</strong><small>地形と高低差を俯瞰して確認</small></div><b>→</b></button>
        <ElevationChart values={course.elevationProfile} />
        {!isPreview && <section className={`live-road-info ${liveInfo?.status ?? 'caution'}`} aria-label="リアルタイム道路情報">
          <div className="live-road-head"><h3>走行前のライブ情報</h3><span>{liveInfo ? '同期済み' : '未同期'}</span></div>
          <div className="live-road-grid"><div><b>天候</b><span>{liveInfo?.weather ?? weather?.summary ?? '取得できませんでした'}{liveInfo?.temperature ? ` · ${liveInfo.temperature}` : weather ? ` · ${weather.temperature}` : ''}</span></div><div><b>通行規制</b><span>{liveInfo?.restriction ?? '公式情報の同期待ち'}</span></div><div><b>交通量</b><span>{liveInfo?.traffic ?? '公式情報の同期待ち'}</span></div></div>
          <small>{liveInfo ? `${liveInfo.sourceName} · 更新 ${liveInfo.updatedAt}` : weather ? `${weather.sourceName} · 更新 ${weather.updatedAt}。規制・交通量は公的情報の同期後に表示します。` : '天候を取得できませんでした。通行規制・交通量は現地標識・道路管理者の公式情報を確認してください。'}</small>
        </section>}
        <section className="rating-summary" aria-label="評価の内訳">
          <div className="rating-summary-head"><strong>総合評価 {overallRating(mergedRatings)}</strong><span>システム評価を基準にユーザー評価を反映</span></div>
          <RatingBars ratings={mergedRatings} />
          <div className="rating-provenance"><span>システム評価: {overallRating(systemRatings)} / 5</span><span>ユーザー評価: {userCount}件</span></div>
          {userCount === 0 && <p className="rating-empty">ユーザー評価はまだありません。実際に走行した感想を最初に投稿できます。</p>}
          {course.systemRatingSource?.length ? <p className="rating-source">算出根拠: {course.systemRatingSource.join('、')}（{course.systemRatingUpdatedAt ?? course.updatedAt}）</p> : null}
        </section>
        {!isPreview && <section className={`toll-box ${tollStatus}`}>
          <div className="toll-title"><h3>{tollStatusLabels[tollStatus]}</h3><span>{course.tollInfo?.standardFee}</span></div>
          {!course.tollInfo && <p>料金情報はまだ確認できていません。走行前に道路管理者の公式情報と現地標識を確認してください。</p>}
          {course.tollInfo && <>
          {course.tollInfo.hours && <p><b>時間:</b> {course.tollInfo.hours}</p>}
          <p><b>無料条件:</b> {course.tollInfo.freePassConditions.length ? course.tollInfo.freePassConditions.join('、') : '確認できた恒常的な無料条件なし'}</p>
          {course.tollInfo.notes && <p>{course.tollInfo.notes}</p>}
          <footer>{course.tollInfo.sourceUrl ? <a href={course.tollInfo.sourceUrl} target="_blank" rel="noreferrer">{course.tollInfo.sourceName} ↗</a> : <span>{course.tollInfo.sourceName}</span>}<small>確認 {course.tollInfo.checkedAt}</small></footer>
          </>}
          <button onClick={onReportToll}>無料開放・料金変更を報告</button>
        </section>}
        <section className="caution-box"><h3>走行前に確認</h3><ul>{course.cautions.map((item) => <li key={item}>{item}</li>)}</ul><small>最終更新: {course.updatedAt}。現地標識・公的情報を優先してください。</small></section>
        {canManageCourse && <section className="course-owner-actions" aria-label="自分のコースの管理"><div><h3>自分が登録したコース</h3><p>名称・説明・公開範囲・タグ・注意事項を編集できます。削除は確認後にFirebaseから実行されます。</p></div><button className="button secondary" onClick={onManageCourse}>編集・削除</button></section>}
        {!isPreview && <div className="secondary-actions">
          <button onClick={onRate}>項目別に評価</button>
          <button onClick={onShare}>コースを共有</button>
          <button onClick={onCommunity}>コメント・いいね</button>
          <button onClick={onReportRoad}>道路状況を報告</button>
          {onOpenTimer && <button onClick={onOpenTimer}>走行タイマー</button>}
          {onToggleMapRoute && <button onClick={onToggleMapRoute}>{mapHidden ? '地図に表示する' : '地図から隠す'}</button>}
        </div>}
      </div>
      <footer className="nav-actions">
        <div className="navigation-direction"><span>{!isPreview && navigationReversed ? 'GOAL → START' : 'START → GOAL'}</span><button type="button" onClick={() => {
          if (isPreview && onReversePreview) {
            // The preview itself is reversed by the parent, so do not also
            // reverse its Google Maps URL a second time.
            setNavigationReversed(false)
            onReversePreview()
            return
          }
          setNavigationReversed((value) => !value)
        }}>⇄ 始点とゴールを入れ替える</button></div>
        <div className="navigation-links"><a className="button secondary" href={googleMapsUrl(course, false, navigationReversed)} target="_blank" rel="noreferrer">コースだけ開く</a><a className="button primary" href={googleMapsUrl(course, true, navigationReversed)} target="_blank" rel="noreferrer">現在地から案内</a></div>
      </footer>
      <div className="detail-peek-handle" aria-label="上へスワイプしてコース詳細を再表示" {...sheet.dragProps}><span>{course.name}</span></div>
    </article>
  )
}
