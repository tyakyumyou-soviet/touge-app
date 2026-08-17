import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Course } from '../types'
import { isSuspiciousElevationProfile } from './elevation'

type ContourProperties = { elevation: number; label: string }

// Build lightweight route-local contour cues from the same elevation profile
// used by the course rating. Broad intervals keep the map readable.
export function toContourFeatureCollection(course: Course | null): FeatureCollection<LineString, ContourProperties> {
  if (!course || course.route.length < 2) return { type: 'FeatureCollection', features: [] }
  const values = course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation]
  const min = Math.min(...values); const max = Math.max(...values); const step = max - min >= 500 ? 100 : 50
  const features: Feature<LineString, ContourProperties>[] = []
  for (let elevation = Math.ceil(min / step) * step; elevation <= max; elevation += step) {
    for (let index = 1; index < course.route.length; index += 1) {
      const before = values[Math.min(values.length - 1, Math.round(((index - 1) / (course.route.length - 1)) * (values.length - 1)))]
      const after = values[Math.min(values.length - 1, Math.round((index / (course.route.length - 1)) * (values.length - 1)))]
      if ((before - elevation) * (after - elevation) > 0 || before === after) continue
      const amount = (elevation - before) / (after - before)
      const [lng1, lat1] = course.route[index - 1]; const [lng2, lat2] = course.route[index]
      const lng = lng1 + (lng2 - lng1) * amount; const lat = lat1 + (lat2 - lat1) * amount
      const dx = (lng2 - lng1) || .00001; const dy = (lat2 - lat1) || .00001; const length = .0022
      const norm = Math.max(.00001, Math.hypot(dx, dy)); const offsetLng = (-dy / norm) * length; const offsetLat = (dx / norm) * length
      features.push({ type: 'Feature', properties: { elevation, label: `${elevation}m` }, geometry: { type: 'LineString', coordinates: [[lng - offsetLng, lat - offsetLat], [lng + offsetLng, lat + offsetLat]] } })
    }
  }
  return { type: 'FeatureCollection', features }
}

type CourseAnnotationProperties = { label: string; kind: 'ic' | 'place' | 'viewpoint' | 'gradient' | 'curves' }

export function toCourseAnnotationCollection(course: Course | null): FeatureCollection<Point, CourseAnnotationProperties> {
  if (!course || course.route.length < 2) return { type: 'FeatureCollection', features: [] }
  const features: Feature<Point, CourseAnnotationProperties>[] = []
  const pointAt = (progress: number) => course.route[Math.min(course.route.length - 1, Math.max(0, Math.round(progress * (course.route.length - 1))))]
  const landmarks = course.landmarks?.length ? course.landmarks : []
  landmarks.forEach((landmark) => features.push({ type: 'Feature', properties: { label: landmark.name, kind: landmark.type ?? 'place' }, geometry: { type: 'Point', coordinates: pointAt(landmark.progress) } }))
  const profile = course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation]
  let steepIndex = 0; let steepScore = 0
  const sampleDistanceMetres = (course.distanceKm * 1000) / Math.max(1, profile.length - 1)
  if (!isSuspiciousElevationProfile(profile)) for (let index = 1; index < profile.length; index += 1) {
    const gradePercent = sampleDistanceMetres > 0 ? Math.abs((profile[index] - profile[index - 1]) / sampleDistanceMetres) * 100 : 0
    if (gradePercent > steepScore) { steepScore = gradePercent; steepIndex = index }
  }
  if (steepScore >= 4) features.push({ type: 'Feature', properties: { label: `急勾配 ${steepScore.toFixed(1)}%`, kind: 'gradient' }, geometry: { type: 'Point', coordinates: pointAt(steepIndex / Math.max(1, profile.length - 1)) } })
  let curveIndex = Math.floor((course.route.length - 1) * .35); let curveScore = 0
  for (let index = 1; index < course.route.length - 1; index += 1) { const a = course.route[index - 1]; const b = course.route[index]; const c = course.route[index + 1]; const bend = Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])); if (bend > curveScore) { curveScore = bend; curveIndex = index } }
  if (curveScore > 0) features.push({ type: 'Feature', properties: { label: '連続カーブ', kind: 'curves' }, geometry: { type: 'Point', coordinates: course.route[curveIndex] } })
  features.push({ type: 'Feature', properties: { label: '展望区間', kind: 'viewpoint' }, geometry: { type: 'Point', coordinates: pointAt(.72) } })
  return { type: 'FeatureCollection', features }
}
