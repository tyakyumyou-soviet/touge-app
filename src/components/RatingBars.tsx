import { overallRating } from '../lib/course'
import { ratingLabels, type Ratings } from '../types'

export function RatingBars({ ratings, compact = false }: { ratings: Ratings; compact?: boolean }) {
  const entries = Object.entries(ratingLabels) as [keyof Ratings, string][]
  return (
    <div className={compact ? 'rating-bars compact' : 'rating-bars'}>
      {!compact && <div className="overall-score"><strong>{overallRating(ratings)}</strong><span>総合 / 5</span></div>}
      <div className="rating-grid">
        {entries.map(([key, label]) => (
          <div className={`rating-item ${['curves', 'elevation', 'width'].includes(key) ? 'primary' : ''}`} key={key}>
            <span>{label}</span>
            <div className="bar" aria-label={`${label} ${ratings[key]}点`}><i style={{ width: `${ratings[key] * 20}%` }} /></div>
            <b>{ratings[key].toFixed(1)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}
