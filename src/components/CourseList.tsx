import type { Course } from '../types'
import { overallRating } from '../lib/course'

export function CourseList({ courses, selectedId, onSelect }: { courses: Course[]; selectedId?: string; onSelect: (course: Course) => void }) {
  return (
    <div className="course-list" aria-live="polite">
      {courses.length === 0 && <div className="empty-state"><strong>条件に合うコースがありません</strong><span>フィルターを変更してみてください。</span></div>}
      {courses.map((course) => (
        <button key={course.id} className={`course-card ${selectedId === course.id ? 'selected' : ''}`} onClick={() => onSelect(course)}>
          <div className="course-card-top"><span>{course.prefecture} · {course.area}</span><b>★ {overallRating(course.ratings)}</b></div>
          <h3>{course.name}</h3>
          <div className="mini-metrics"><span>{course.distanceKm} km</span><span>{course.durationMin}分</span><span>高低差 {course.maxElevation - course.minElevation}m</span></div>
          <div className="tag-row">{course.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
        </button>
      ))}
    </div>
  )
}
