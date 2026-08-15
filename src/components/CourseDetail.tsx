import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Course } from '../types'
import { combinedRatings, googleMapsUrl, overallRating, systemRatingsFor, userRatingCountFor } from '../lib/course'
import { loadLiveRoadInfo } from '../lib/firebase'
import type { LiveRoadInfo } from '../types'
import { ElevationChart } from './ElevationChart'
import { RatingBars } from './RatingBars'

interface Props {
  course: Course
  onClose: () => void
  onRate: () => void
  onShare: () => void
  onOpen3d: () => void
  onReportToll: () => void
  onCommunity: () => void
}

export function CourseDetail({ course, onClose, onRate, onShare, onOpen3d, onReportToll, onCommunity }: Props) {
  const sheetDrag = useRef<{ pointerId: number; y: number } | null>(null)
  const [sheetOffset, setSheetOffset] = useState(0)
  const [sheetDragging, setSheetDragging] = useState(false)
  const [sheetExpanded, setSheetExpanded] = useState(false)
  const [sheetCollapsed, setSheetCollapsed] = useState(false)
  const [liveInfo, setLiveInfo] = useState<LiveRoadInfo | null>(null)
  const systemRatings = systemRatingsFor(course)
  const mergedRatings = combinedRatings(course)
  const userCount = userRatingCountFor(course)
  useEffect(() => { loadLiveRoadInfo(course.id).then(setLiveInfo).catch(() => setLiveInfo(null)) }, [course.id])

  function startSheetDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    sheetDrag.current = { pointerId: event.pointerId, y: event.clientY }
    setSheetDragging(true)
  }
  function moveSheetDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = event.clientY - drag.y
    setSheetOffset(sheetCollapsed ? Math.min(0, distance) : Math.max(0, distance))
  }
  function endSheetDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = event.clientY - drag.y
    sheetDrag.current = null
    setSheetDragging(false)
    setSheetOffset(0)
    if (sheetCollapsed) {
      if (distance < -24) setSheetCollapsed(false)
      return
    }
    if (distance > 82) setSheetCollapsed(true)
    else if (distance < -42) setSheetExpanded(true)
    else if (distance > 24) setSheetExpanded(false)
  }

  return (
    <article className={`detail-panel ${sheetExpanded ? 'expanded' : ''} ${sheetCollapsed ? 'collapsed' : ''} ${sheetDragging ? 'dragging' : ''}`} style={{ transform: sheetCollapsed ? `translateY(calc(100% - 54px + ${sheetOffset}px))` : sheetOffset ? `translateY(${sheetOffset}px)` : undefined }} aria-label={`${course.name}の詳細`}>
      <div className="drag-handle" aria-label="下へスワイプして詳細を閉じる。上へスワイプして詳細を広げる" onPointerDown={startSheetDrag} onPointerMove={moveSheetDrag} onPointerUp={endSheetDrag} onPointerCancel={endSheetDrag} />
      <header className="detail-header">
        <div><p className="eyebrow">{course.prefecture} · {course.area}</p><h2>{course.name}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="詳細を閉じる">×</button>
      </header>
      <div className="detail-scroll">
        <div className="hero-metrics">
          <div><strong>{course.distanceKm}</strong><span>km</span></div>
          <div><strong>{course.durationMin}</strong><span>分</span></div>
          <div><strong>{course.maxElevation - course.minElevation}</strong><span>m 高低差</span></div>
          <div className="score"><strong>{overallRating(mergedRatings)}</strong><span>総合評価</span></div>
        </div>
        <div className="tag-row">{course.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="description">{course.description}</p>
        <button className="three-d-cta" onClick={onOpen3d}><span>3D</span><div><strong>立体コースビュー</strong><small>地形と高低差を俯瞰して確認</small></div><b>→</b></button>
        <ElevationChart values={course.elevationProfile} />
        <section className={`live-road-info ${liveInfo?.status ?? 'caution'}`} aria-label="リアルタイム道路情報">
          <div className="live-road-head"><h3>走行前のライブ情報</h3><span>{liveInfo ? '同期済み' : '未同期'}</span></div>
          {liveInfo ? <div className="live-road-grid"><div><b>天候</b><span>{liveInfo.weather}{liveInfo.temperature ? ` · ${liveInfo.temperature}` : ''}</span></div><div><b>通行規制</b><span>{liveInfo.restriction}</span></div><div><b>交通量</b><span>{liveInfo.traffic}</span></div></div> : <p>天候・通行規制・交通量は管理者が公的情報から同期すると表示されます。現地標識を優先してください。</p>}
          <small>{liveInfo ? `${liveInfo.sourceName} · 更新 ${liveInfo.updatedAt}` : '外部APIのキーをクライアントに置かず、Firebase Functions等から取り込む設計です。'}</small>
        </section>
        <section className="rating-summary" aria-label="評価の内訳">
          <div className="rating-summary-head"><strong>総合評価 {overallRating(mergedRatings)}</strong><span>システム評価を基準にユーザー評価を反映</span></div>
          <RatingBars ratings={mergedRatings} />
          <div className="rating-provenance"><span>システム評価: {overallRating(systemRatings)} / 5</span><span>ユーザー評価: {userCount}件</span></div>
          {userCount === 0 && <p className="rating-empty">ユーザー評価はまだありません。実際に走行した感想を最初に投稿できます。</p>}
          {course.systemRatingSource?.length ? <p className="rating-source">算出根拠: {course.systemRatingSource.join('、')}（{course.systemRatingUpdatedAt ?? course.updatedAt}）</p> : null}
        </section>
        {course.tollInfo && <section className={`toll-box ${course.tollInfo.type}`}>
          <div className="toll-title"><h3>{course.tollInfo.type === 'free' ? '無料道路' : '通行料金情報'}</h3><span>{course.tollInfo.standardFee}</span></div>
          {course.tollInfo.hours && <p><b>時間:</b> {course.tollInfo.hours}</p>}
          <p><b>無料条件:</b> {course.tollInfo.freePassConditions.length ? course.tollInfo.freePassConditions.join('、') : '確認できた恒常的な無料条件なし'}</p>
          {course.tollInfo.notes && <p>{course.tollInfo.notes}</p>}
          <footer><a href={course.tollInfo.sourceUrl} target="_blank" rel="noreferrer">{course.tollInfo.sourceName} ↗</a><small>確認 {course.tollInfo.checkedAt}</small></footer>
          <button onClick={onReportToll}>無料開放・料金変更を報告</button>
        </section>}
        <section className="caution-box"><h3>走行前に確認</h3><ul>{course.cautions.map((item) => <li key={item}>{item}</li>)}</ul><small>最終更新: {course.updatedAt}。現地標識・公的情報を優先してください。</small></section>
        <div className="secondary-actions">
          <button onClick={onRate}>項目別に評価</button>
          <button onClick={onShare}>コースを共有</button>
          <button onClick={onCommunity}>コメント・いいね</button>
        </div>
      </div>
      <footer className="nav-actions">
        <a className="button secondary" href={googleMapsUrl(course, false)} target="_blank" rel="noreferrer">コースだけ開く</a>
        <a className="button primary" href={googleMapsUrl(course, true)} target="_blank" rel="noreferrer">現在地から案内</a>
      </footer>
      <div className="detail-peek-handle" aria-label="上へスワイプしてコース詳細を再表示" onPointerDown={startSheetDrag} onPointerMove={moveSheetDrag} onPointerUp={endSheetDrag} onPointerCancel={endSheetDrag}><span>{course.name}</span></div>
    </article>
  )
}
