import type { ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import type { Course } from '../types'
import { combinedRatings, overallRating, userRatingCountFor } from '../lib/course'
import { courseTollStatus, tollStatusLabels } from '../lib/toll'

type ScrollProps = {
  onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void
  onTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => void
  onTouchEnd: (event: ReactTouchEvent<HTMLDivElement>) => void
  onTouchCancel: (event: ReactTouchEvent<HTMLDivElement>) => void
}

export function CourseList({ courses, selectedId, onSelect, header, scrollProps }: { courses: Course[]; selectedId?: string; onSelect: (course: Course) => void; header?: ReactNode; scrollProps?: ScrollProps }) {
  return (
    <div className="course-list" data-sheet-scroll aria-live="polite" {...scrollProps}>
      {header}
      {courses.length === 0 && <div className="empty-state"><strong>条件に合うコースがありません</strong><span>フィルターを変更してみてください。</span></div>}
      {courses.map((course) => (
        <button key={course.id} className={`course-card ${selectedId === course.id ? 'selected' : ''}`} onClick={() => onSelect(course)}>
          <div className="course-card-top"><span>{course.prefecture} · {course.area}</span><b>★ {overallRating(combinedRatings(course))}</b></div>
          <h3>{course.name}</h3>
          <div className="mini-metrics"><span>{course.distanceKm} km</span><span>{course.durationMin}分</span><span>高低差 {course.maxElevation - course.minElevation}m</span></div>
          <small className="user-rating-count">ユーザー評価 {userRatingCountFor(course)}件</small>
          <div className="tag-row"><span className={`toll-chip ${courseTollStatus(course)}`}>{tollStatusLabels[courseTollStatus(course)]}</span>{course.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
        </button>
      ))}
    </div>
  )
}
