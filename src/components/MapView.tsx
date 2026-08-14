import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Coordinate, Course } from '../types'
import { supportsWebGL } from '../lib/webgl'

interface MapViewProps {
  courses: Course[]
  selected: Course | null
  is3d: boolean
  drawing: boolean
  draftRoute: Coordinate[]
  onSelect: (course: Course) => void
  onAddPoint: (point: Coordinate) => void
}

const toFeatureCollection = (courses: Course[]) => ({
  type: 'FeatureCollection' as const,
  features: courses.map((course) => ({
    type: 'Feature' as const,
    properties: { id: course.id, name: course.name },
    geometry: { type: 'LineString' as const, coordinates: course.route },
  })),
})

// Build lightweight route-local contour cues from the same elevation profile
// used by the course rating. They are intentionally shown only at broad
// intervals so the map remains readable while still making large climbs obvious.
type ContourProperties = { elevation: number; label: string }
export const toContourFeatureCollection = (course: Course | null): FeatureCollection<LineString, ContourProperties> => {
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
  return { type: 'FeatureCollection' as const, features }
}

type CourseAnnotationProperties = { label: string; kind: 'ic' | 'place' | 'viewpoint' | 'gradient' | 'curves' }
export const toCourseAnnotationCollection = (course: Course | null): FeatureCollection<Point, CourseAnnotationProperties> => {
  if (!course || course.route.length < 2) return { type: 'FeatureCollection', features: [] }
  const features: Feature<Point, CourseAnnotationProperties>[] = []
  const pointAt = (progress: number) => course.route[Math.min(course.route.length - 1, Math.max(0, Math.round(progress * (course.route.length - 1))))]
  const landmarks = course.landmarks?.length ? course.landmarks : []
  landmarks.forEach((landmark) => features.push({ type: 'Feature', properties: { label: landmark.name, kind: landmark.type ?? 'place' }, geometry: { type: 'Point', coordinates: pointAt(landmark.progress) } }))
  const profile = course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation]
  let steepIndex = 0; let steepScore = 0
  for (let index = 1; index < profile.length; index += 1) { const score = Math.abs(profile[index] - profile[index - 1]); if (score > steepScore) { steepScore = score; steepIndex = index } }
  if (steepScore > 20) features.push({ type: 'Feature', properties: { label: '急勾配', kind: 'gradient' }, geometry: { type: 'Point', coordinates: pointAt(steepIndex / Math.max(1, profile.length - 1)) } })
  let curveIndex = Math.floor((course.route.length - 1) * .35); let curveScore = 0
  for (let index = 1; index < course.route.length - 1; index += 1) { const a = course.route[index - 1]; const b = course.route[index]; const c = course.route[index + 1]; const bend = Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])); if (bend > curveScore) { curveScore = bend; curveIndex = index } }
  if (curveScore > 0) features.push({ type: 'Feature', properties: { label: '連続カーブ', kind: 'curves' }, geometry: { type: 'Point', coordinates: course.route[curveIndex] } })
  features.push({ type: 'Feature', properties: { label: '展望区間', kind: 'viewpoint' }, geometry: { type: 'Point', coordinates: pointAt(.72) } })
  return { type: 'FeatureCollection', features }
}

export function MapView({ courses, selected, is3d, drawing, draftRoute, onSelect, onAddPoint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const coursesRef = useRef(courses)
  const drawingRef = useRef(drawing)
  const [mapError, setMapError] = useState('')

  useEffect(() => { coursesRef.current = courses }, [courses])
  useEffect(() => { drawingRef.current = drawing }, [drawing])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!supportsWebGL()) { setMapError('この端末では3D地図を表示できません。コース一覧と詳細情報は引き続き利用できます。'); return }
    let map: MapLibreMap
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [139.03, 35.22],
        zoom: 8.2,
        pitch: 0,
        maxPitch: 85,
        attributionControl: false,
      })
    } catch {
      setMapError('地図を初期化できませんでした。端末のWebGL設定を確認してください。')
      return
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15,
      })
      map.addLayer({
        id: 'terrain-hillshade', type: 'hillshade', source: 'terrain-dem',
        paint: { 'hillshade-exaggeration': .34, 'hillshade-shadow-color': '#42574d', 'hillshade-highlight-color': '#f6f1dd', 'hillshade-accent-color': '#718477' },
      })
      map.addSource('courses', { type: 'geojson', data: toFeatureCollection(coursesRef.current) })
      map.addLayer({
        id: 'courses-shadow', type: 'line', source: 'courses',
        paint: { 'line-color': '#101915', 'line-width': 7, 'line-opacity': 0.48 },
      })
      map.addLayer({
        id: 'courses-line', type: 'line', source: 'courses',
        paint: { 'line-color': '#d69f35', 'line-width': 3.5 },
      })
      map.addSource('selected-course', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addSource('selected-contours', { type: 'geojson', data: toContourFeatureCollection(null) })
      map.addLayer({ id: 'selected-contours', type: 'line', source: 'selected-contours', paint: { 'line-color': '#637e70', 'line-width': 1.2, 'line-opacity': .62, 'line-dasharray': [1, 2] } })
      map.addLayer({ id: 'selected-glow', type: 'line', source: 'selected-course', paint: { 'line-color': '#101915', 'line-width': 12, 'line-opacity': .58 } })
      map.addLayer({ id: 'selected-line', type: 'line', source: 'selected-course', paint: { 'line-color': '#f2d16b', 'line-width': 6 } })
      map.addSource('draft', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ee704f', 'line-width': 5, 'line-dasharray': [1.2, 1] } })
      map.addLayer({ id: 'selected-contour-labels', type: 'symbol', source: 'selected-contours', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#3d5b4c', 'text-halo-color': '#f6f1dd', 'text-halo-width': 1.5 } })
      map.addSource('course-annotations', { type: 'geojson', data: toCourseAnnotationCollection(null) })
      map.addLayer({ id: 'course-annotation-points', type: 'circle', source: 'course-annotations', paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'kind'], 'gradient', '#df624a', 'curves', '#d69f35', 'viewpoint', '#4c9ed9', '#4c9b79'], 'circle-stroke-color': '#f6f1dd', 'circle-stroke-width': 1.5 } })
      map.addLayer({ id: 'course-annotation-labels', type: 'symbol', source: 'course-annotations', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -1.25], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd', 'text-halo-width': 2 } })
    })

    map.on('mouseenter', 'courses-line', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'courses-line', () => { map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '' })
    map.on('click', 'courses-line', (event) => {
      if (drawingRef.current) return
      const id = event.features?.[0]?.properties?.id as string | undefined
      const course = coursesRef.current.find((item) => item.id === id)
      if (course) onSelect(course)
    })
    map.on('click', (event) => {
      if (drawingRef.current) onAddPoint([event.lngLat.lng, event.lngLat.lat])
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [onAddPoint, onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    ;(map.getSource('courses') as GeoJSONSource | undefined)?.setData(toFeatureCollection(courses))
  }, [courses])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const source = map.getSource('draft') as GeoJSONSource | undefined
    source?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draftRoute } })
    map.getCanvas().style.cursor = drawing ? 'crosshair' : ''
  }, [drawing, draftRoute])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const source = map.getSource('selected-course') as GeoJSONSource | undefined
    source?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selected?.route ?? [] } })
    ;(map.getSource('selected-contours') as GeoJSONSource | undefined)?.setData(toContourFeatureCollection(selected))
    ;(map.getSource('course-annotations') as GeoJSONSource | undefined)?.setData(toCourseAnnotationCollection(selected))
    if (!selected) return
    const bounds = selected.route.reduce(
      (value, point) => value.extend(point),
      new maplibregl.LngLatBounds(selected.route[0], selected.route[0]),
    )
    map.fitBounds(bounds, { padding: { top: 110, bottom: 210, left: 40, right: 40 }, maxZoom: 12.5, duration: 900 })
  }, [selected])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    map.setTerrain(is3d ? { source: 'terrain-dem', exaggeration: 1.45 } : null)
    map.easeTo({ pitch: is3d ? 68 : 0, bearing: is3d ? -18 : 0, duration: 900 })
  }, [is3d])

  if (mapError) return <div className="map map-fallback" role="status"><div><strong>地図を表示できません</strong><p>{mapError}</p><button onClick={() => location.reload()}>再読み込み</button></div></div>
  return <div ref={containerRef} className="map" aria-label="峠コース地図" />
}
