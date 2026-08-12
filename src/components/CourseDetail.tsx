import type { Course } from '../types'
import { googleMapsUrl, overallRating } from '../lib/course'
import { ElevationChart } from './ElevationChart'
import { RatingBars } from './RatingBars'

interface Props {
  course: Course
  onClose: () => void
  onRate: () => void
  onShare: () => void
  onOpen3d: () => void
  onReportToll: () => void
}

export function CourseDetail({ course, onClose, onRate, onShare, onOpen3d, onReportToll }: Props) {
  return (
    <article className="detail-panel" aria-label={`${course.name}の詳細`}>
      <div className="drag-handle" />
      <header className="detail-header">
        <div><p className="eyebrow">{course.prefecture} · {course.area}</p><h2>{course.name}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="詳細を閉じる">×</button>
      </header>
      <div className="detail-scroll">
        <div className="hero-metrics">
          <div><strong>{course.distanceKm}</strong><span>km</span></div>
          <div><strong>{course.durationMin}</strong><span>分</span></div>
          <div><strong>{course.maxElevation - course.minElevation}</strong><span>m 高低差</span></div>
          <div className="score"><strong>{overallRating(course.ratings)}</strong><span>{course.ratingCount}件</span></div>
        </div>
        <div className="tag-row">{course.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="description">{course.description}</p>
        <button className="three-d-cta" onClick={onOpen3d}><span>3D</span><div><strong>立体コースビュー</strong><small>地形と高低差を俯瞰して確認</small></div><b>→</b></button>
        <ElevationChart values={course.elevationProfile} />
        <RatingBars ratings={course.ratings} />
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
        </div>
      </div>
      <footer className="nav-actions">
        <a className="button secondary" href={googleMapsUrl(course, false)} target="_blank" rel="noreferrer">コースだけ開く</a>
        <a className="button primary" href={googleMapsUrl(course, true)} target="_blank" rel="noreferrer">現在地から案内</a>
      </footer>
    </article>
  )
}
