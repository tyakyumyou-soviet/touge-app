import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Coordinate, Course, DraftPointRole, RecommendationMapAction, RecommendationMapState } from '../types'
import { supportsWebGL } from '../lib/webgl'
import { routeAlongRoads } from '../lib/routing'
import { toContourFeatureCollection, toCourseAnnotationCollection } from '../lib/mapOverlays'
import { assignCourseColors } from '../lib/courseColors'
import { bottomSheetInset } from '../lib/mapCamera'
import { createTougeMapStyle } from '../lib/mapStyle'
import { mapDraftActions } from '../lib/mapDraftActions'

interface MapViewProps {
  courses: Course[]
  selected: Course | null
  previewCourseIds: string[]
  focusRequest?: number
  draftFitRequest?: number
  is3d: boolean
  drawing: boolean
  draftRoute: Coordinate[]
  draftLabels: string[]
  draftRoles: DraftPointRole[]
  viaInsertAfter: number | null
  focusPoint: Coordinate | null
  pendingSearchPoint: Coordinate | null
  pendingSearchLabel: string
  recommendationMapState: RecommendationMapState
  currentLocation: Coordinate | null
  searchCenter?: Coordinate | null
  searchRadiusKm?: number
  onCurrentLocationChange: (point: Coordinate) => void
  onSelect: (course: Course) => void
  onRecommendationMapAction: (action: Omit<RecommendationMapAction, 'id'>) => void
  onAddPoint: (point: Coordinate, label?: string, role?: 'via' | 'goal', insertAfter?: number | null) => void
  onMovePoint: (index: number, point: Coordinate) => void
}

const toFeatureCollection = (courses: Course[], colors: Map<string, string>) => ({
  type: 'FeatureCollection' as const,
  features: courses.map((course) => ({
    type: 'Feature' as const,
    properties: { id: course.id, name: course.name, color: colors.get(course.id) ?? '#d69f35' },
    geometry: { type: 'LineString' as const, coordinates: course.route },
  })),
})

const toDraftPointCollection = (route: Coordinate[], labels: string[] = [], roles: DraftPointRole[] = []) => ({
  type: 'FeatureCollection' as const,
  features: route.map((point, index) => ({
    type: 'Feature' as const,
    properties: {
      index,
      label: roles[index] === 'start' || (!roles.length && index === 0) ? 'S' : roles[index] === 'goal' || (!roles.length && index === route.length - 1) ? 'G' : String(roles.slice(0, index + 1).filter((role) => role === 'via').length || index),
      name: labels[index] || '地図指定',
    },
    geometry: { type: 'Point' as const, coordinates: point },
  })),
})

const toPendingSearchPoint = (point: Coordinate | null, label: string) => ({
  type: 'FeatureCollection' as const,
  features: point ? [{
    type: 'Feature' as const,
    properties: { label },
    geometry: { type: 'Point' as const, coordinates: point },
  }] : [],
})

const toRecommendationPointCollection = (state: RecommendationMapState) => ({
  type: 'FeatureCollection' as const,
  features: !state.active ? [] : [
    ...(state.center ? [{ point: state.center, role: 'center', index: 0 }] : []),
    ...(state.start ? [{ point: state.start, role: 'start', index: 0 }] : []),
    ...state.vias.map((point, index) => ({ point, role: 'via', index })),
    ...(state.goal ? [{ point: state.goal, role: 'goal', index: 0 }] : []),
  ].map(({ point, role, index }) => ({
    type: 'Feature' as const,
    properties: { role, index, label: point.label, marker: role === 'center' ? '探索中心' : role === 'start' ? 'S' : role === 'goal' ? 'G' : '経' },
    geometry: { type: 'Point' as const, coordinates: point.coordinate },
  })),
})

const toCurrentLocation = (point: Coordinate | null) => ({
  type: 'FeatureCollection' as const,
  features: point ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: point } }] : [],
})

/** A lightweight geodesic approximation used only for the visible search radius. */
const toSearchRadius = (center: Coordinate | null | undefined, radiusKm: number | undefined) => ({
  type: 'FeatureCollection' as const,
  features: !center || !radiusKm ? [] : [{
    type: 'Feature' as const,
    properties: { radiusKm },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [Array.from({ length: 65 }, (_, index) => {
        const angle = (index / 64) * Math.PI * 2
        const latitude = center[1] + (radiusKm / 110.574) * Math.sin(angle)
        const longitude = center[0] + (radiusKm / (111.32 * Math.cos(center[1] * Math.PI / 180))) * Math.cos(angle)
        return [longitude, latitude] as Coordinate
      })],
    },
  }],
})

/** Fits any map-rendered route into the area that remains above active sheets. */
function fitRouteToVisibleMap(map: MapLibreMap, container: HTMLElement, route: Coordinate[], margin: { top: number; right: number; bottom: number; left: number }, duration: number) {
  if (!route.length) return
  const rect = container.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return
  const sheetRects = [...document.querySelectorAll<HTMLElement>('[data-map-occlusion="bottom-sheet"]')].map((sheet) => sheet.getBoundingClientRect())
  const hiddenBottom = bottomSheetInset(rect, sheetRects)
  const visible = { left: margin.left, right: rect.width - margin.right, top: margin.top, bottom: rect.height - hiddenBottom - margin.bottom }
  const visibleWidth = visible.right - visible.left
  const visibleHeight = visible.bottom - visible.top
  if (visibleWidth < 48 || visibleHeight < 48) return
  const projected = route.map((point) => map.project(point))
  const minX = Math.min(...projected.map((point) => point.x)); const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y)); const maxY = Math.max(...projected.map((point) => point.y))
  const scale = Math.max((maxX - minX) / visibleWidth, (maxY - minY) / visibleHeight, .0001)
  const currentZoom = map.getZoom()
  const zoom = Math.min(14.5, Math.max(map.getMinZoom(), currentZoom - Math.log2(scale)))
  const zoomFactor = 2 ** (zoom - currentZoom)
  const routeCentre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  const targetCentre = { x: (visible.left + visible.right) / 2, y: (visible.top + visible.bottom) / 2 }
  const screenCentre = { x: rect.width / 2, y: rect.height / 2 }
  const center = map.unproject([
    routeCentre.x - (targetCentre.x - screenCentre.x) / zoomFactor,
    routeCentre.y - (targetCentre.y - screenCentre.y) / zoomFactor,
  ])
  if (duration) map.easeTo({ center, zoom, duration, essential: true })
  else map.jumpTo({ center, zoom })
}

export function MapView({ courses, selected, previewCourseIds, focusRequest = 0, draftFitRequest = 0, is3d, drawing, draftRoute, draftLabels, draftRoles, viaInsertAfter, focusPoint, pendingSearchPoint, pendingSearchLabel, recommendationMapState, currentLocation, searchCenter, searchRadiusKm, onCurrentLocationChange, onSelect, onRecommendationMapAction, onAddPoint, onMovePoint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const coursesRef = useRef(courses)
  const drawingRef = useRef(drawing)
  const onAddPointRef = useRef(onAddPoint)
  const onMovePointRef = useRef(onMovePoint)
  const onSelectRef = useRef(onSelect)
  const previewCourseIdsRef = useRef(new Set(previewCourseIds))
  const draftPopupRef = useRef<maplibregl.Popup | null>(null)
  const draftRouteRef = useRef(draftRoute)
  const draftLabelsRef = useRef(draftLabels)
  const draftRolesRef = useRef(draftRoles)
  const viaInsertAfterRef = useRef(viaInsertAfter)
  const recommendationMapStateRef = useRef(recommendationMapState)
  const onRecommendationMapActionRef = useRef(onRecommendationMapAction)
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const courseColors = useMemo(() => assignCourseColors(courses), [courses])

  useEffect(() => { coursesRef.current = courses }, [courses])
  useEffect(() => { drawingRef.current = drawing }, [drawing])
  useEffect(() => { onAddPointRef.current = onAddPoint }, [onAddPoint])
  useEffect(() => { onMovePointRef.current = onMovePoint }, [onMovePoint])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { previewCourseIdsRef.current = new Set(previewCourseIds) }, [previewCourseIds])
  useEffect(() => { draftRouteRef.current = draftRoute }, [draftRoute])
  useEffect(() => { draftLabelsRef.current = draftLabels }, [draftLabels])
  useEffect(() => { draftRolesRef.current = draftRoles }, [draftRoles])
  useEffect(() => { viaInsertAfterRef.current = viaInsertAfter }, [viaInsertAfter])
  useEffect(() => { recommendationMapStateRef.current = recommendationMapState }, [recommendationMapState])
  useEffect(() => { onRecommendationMapActionRef.current = onRecommendationMapAction }, [onRecommendationMapAction])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!supportsWebGL()) { setMapError('この端末では3D地図を表示できません。コース一覧と詳細情報は引き続き利用できます。'); return }
    let map: MapLibreMap
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: createTougeMapStyle(),
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
    map.on('error', (event) => {
      const message = event.error?.message ?? ''
      // OpenFreeMap occasionally contains a nullable numeric vector attribute,
      // and a single DEM tile can time out. MapLibre can render the remaining
      // map normally, so consume these recoverable source errors instead of
      // emitting an alarming application error stack.
      if (/Expected value to be of type number, but found null|terrain|DEM|tile/i.test(message)) return
      console.warn('地図データの一部を読み込めませんでした', message)
    })
    // OpenFreeMap styles occasionally reference POI icons that are absent
    // from the current sprite sheet. MapLibre otherwise logs one error for
    // every affected tile. Supply a small neutral fallback so map rendering
    // remains stable without pretending an unrelated icon is available.
    map.on('styleimagemissing', ({ id }) => {
      if (map.hasImage(id)) return
      const size = 8
      const data = new Uint8Array(size * size * 4)
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const offset = (y * size + x) * 4
          const visible = (x - 3.5) ** 2 + (y - 3.5) ** 2 <= 7
          data[offset] = 73; data[offset + 1] = 91; data[offset + 2] = 80; data[offset + 3] = visible ? 190 : 0
        }
      }
      map.addImage(id, { width: size, height: size, data })
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true })
    map.addControl(geolocate, 'top-right')
    geolocate.on('geolocate', (event) => {
      const container = containerRef.current
      if (!container) return
      const result = event as GeolocationPosition
      const point: Coordinate = [result.coords.longitude, result.coords.latitude]
      onCurrentLocationChange(point)
      fitRouteToVisibleMap(map, container, [point], { top: 34, right: 42, bottom: 34, left: 42 }, 500)
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 15,
      })
      map.addLayer({
        id: 'terrain-hillshade', type: 'hillshade', source: 'terrain-dem',
        paint: { 'hillshade-exaggeration': .34, 'hillshade-shadow-color': '#42574d', 'hillshade-highlight-color': '#f6f1dd', 'hillshade-accent-color': '#718477' },
      }, 'road-labels')
      map.addSource('courses', { type: 'geojson', data: toFeatureCollection(coursesRef.current, assignCourseColors(coursesRef.current)) })
      map.addLayer({
        id: 'courses-shadow', type: 'line', source: 'courses',
        paint: { 'line-color': '#101915', 'line-width': 7, 'line-opacity': 0.48 },
      })
      map.addLayer({
        id: 'courses-line', type: 'line', source: 'courses',
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': .96 },
      })
      // The reactive effect below immediately supplies the current filter.
      // Starting empty keeps map construction independent from parent state.
      map.addSource('search-radius', { type: 'geojson', data: toSearchRadius(null, undefined) })
      map.addLayer({ id: 'search-radius-fill', type: 'fill', source: 'search-radius', paint: { 'fill-color': '#27795c', 'fill-opacity': .10 } })
      map.addLayer({ id: 'search-radius-line', type: 'line', source: 'search-radius', paint: { 'line-color': '#27795c', 'line-width': 2, 'line-opacity': .78, 'line-dasharray': [2, 2] } })
      map.addSource('selected-course', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addSource('selected-contours', { type: 'geojson', data: toContourFeatureCollection(null) })
      map.addLayer({ id: 'selected-contours', type: 'line', source: 'selected-contours', paint: { 'line-color': '#637e70', 'line-width': 1.2, 'line-opacity': .62, 'line-dasharray': [1, 2] } })
      map.addLayer({ id: 'selected-glow', type: 'line', source: 'selected-course', paint: { 'line-color': '#101915', 'line-width': 12, 'line-opacity': .58 } })
      map.addLayer({ id: 'selected-line', type: 'line', source: 'selected-course', paint: { 'line-color': '#f2d16b', 'line-width': 6 } })
      map.addSource('draft-road', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'draft-road-line', type: 'line', source: 'draft-road', layout: { visibility: 'none' }, paint: { 'line-color': '#ee704f', 'line-width': 5, 'line-opacity': .9 } })
      map.addSource('draft-points', { type: 'geojson', data: toDraftPointCollection([]) })
      // Keep the draft stops above every course layer.  The small triangular tip
      // makes the otherwise compact numbered marker read as a map pin.
      map.addLayer({ id: 'draft-point-pin-tip', type: 'symbol', source: 'draft-points', layout: { visibility: 'none', 'text-field': '▼', 'text-size': 19, 'text-offset': [0, .72], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': ['match', ['get', 'label'], 'S', '#287e5a', 'G', '#d35a46', '#e1ac3d'] } })
      map.addLayer({ id: 'draft-points', type: 'circle', source: 'draft-points', layout: { visibility: 'none' }, paint: { 'circle-radius': 13, 'circle-color': ['match', ['get', 'label'], 'S', '#287e5a', 'G', '#d35a46', '#e1ac3d'], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff8e7' } })
      map.addLayer({ id: 'draft-point-labels', type: 'symbol', source: 'draft-points', layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#142018' } })
      map.addLayer({ id: 'draft-point-names', type: 'symbol', source: 'draft-points', layout: { visibility: 'none', 'text-field': ['concat', ['get', 'label'], '  ', ['get', 'name']], 'text-size': 13, 'text-offset': [0, 2.15], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#15251b', 'text-halo-color': '#fff8e7', 'text-halo-width': 2.5 } })
      map.addSource('pending-search-point', { type: 'geojson', data: toPendingSearchPoint(null, '') })
      map.addLayer({ id: 'pending-search-pulse', type: 'circle', source: 'pending-search-point', layout: { visibility: 'none' }, paint: { 'circle-radius': 21, 'circle-color': '#e76f51', 'circle-opacity': .2, 'circle-stroke-color': '#d7503d', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': .75 } })
      map.addLayer({ id: 'pending-search-pin-tip', type: 'symbol', source: 'pending-search-point', layout: { visibility: 'none', 'text-field': '▼', 'text-size': 23, 'text-offset': [0, .74], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#e76f51' } })
      map.addLayer({ id: 'pending-search-pin', type: 'circle', source: 'pending-search-point', layout: { visibility: 'none' }, paint: { 'circle-radius': 15, 'circle-color': '#e76f51', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff8e7' } })
      map.addLayer({ id: 'pending-search-label', type: 'symbol', source: 'pending-search-point', layout: { visibility: 'none', 'text-field': ['concat', '仮  ', ['get', 'label']], 'text-size': 13, 'text-offset': [0, 2.35], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#7f2f27', 'text-halo-color': '#fff8e7', 'text-halo-width': 2.5 } })
      map.addSource('recommendation-points', { type: 'geojson', data: toRecommendationPointCollection({ active: false, start: null, goal: null, vias: [] }) })
      map.addLayer({ id: 'recommendation-point-tip', type: 'symbol', source: 'recommendation-points', layout: { visibility: 'none', 'text-field': '▼', 'text-size': 20, 'text-offset': [0, .72], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': ['match', ['get', 'role'], 'start', '#287e5a', 'goal', '#d35a46', '#e1ac3d'] } })
      map.addLayer({ id: 'recommendation-points', type: 'circle', source: 'recommendation-points', layout: { visibility: 'none' }, paint: { 'circle-radius': 14, 'circle-color': ['match', ['get', 'role'], 'start', '#287e5a', 'goal', '#d35a46', '#e1ac3d'], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff8e7' } })
      map.addLayer({ id: 'recommendation-point-labels', type: 'symbol', source: 'recommendation-points', layout: { visibility: 'none', 'text-field': ['concat', ['get', 'marker'], '  ', ['get', 'label']], 'text-size': 13, 'text-offset': [0, 2.15], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#15251b', 'text-halo-color': '#fff8e7', 'text-halo-width': 2.5 } })
      map.addSource('current-location', { type: 'geojson', data: toCurrentLocation(null) })
      map.addLayer({ id: 'current-location-halo', type: 'circle', source: 'current-location', paint: { 'circle-radius': 14, 'circle-color': '#287bdc', 'circle-opacity': .18, 'circle-stroke-color': '#287bdc', 'circle-stroke-width': 1, 'circle-stroke-opacity': .38 } })
      map.addLayer({ id: 'current-location-dot', type: 'circle', source: 'current-location', paint: { 'circle-radius': 7, 'circle-color': '#287bdc', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } })
      map.addLayer({ id: 'selected-contour-labels', type: 'symbol', source: 'selected-contours', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#3d5b4c', 'text-halo-color': '#f6f1dd', 'text-halo-width': 1.5 } })
      map.addSource('course-annotations', { type: 'geojson', data: toCourseAnnotationCollection(null) })
      map.addLayer({ id: 'course-annotation-points', type: 'circle', source: 'course-annotations', paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'kind'], 'gradient', '#df624a', 'curves', '#d69f35', 'viewpoint', '#4c9ed9', '#4c9b79'], 'circle-stroke-color': '#f6f1dd', 'circle-stroke-width': 1.5 } })
      map.addLayer({ id: 'course-annotation-labels', type: 'symbol', source: 'course-annotations', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -1.25], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd', 'text-halo-width': 2 } })
      ;(map.getSource('draft-points') as GeoJSONSource).setData(toDraftPointCollection(draftRouteRef.current, draftLabelsRef.current, draftRolesRef.current))
      setMapReady(true)
    })

    map.on('mouseenter', 'courses-line', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'courses-line', () => { map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '' })
    map.on('click', 'courses-line', (event) => {
      const id = event.features?.[0]?.properties?.id as string | undefined
      if (!id || (drawingRef.current && !previewCourseIdsRef.current.has(id))) return
      const course = coursesRef.current.find((item) => item.id === id)
      if (course) { suppressNextMapClick = true; onSelectRef.current(course) }
    })
    let movingPointIndex: number | null = null
    let touchPressTimer: number | undefined
    let suppressNextMapClick = false
    const beginPointMove = (index: number) => { suppressNextMapClick = true; movingPointIndex = index; map.dragPan.disable(); map.getCanvas().style.cursor = 'grabbing' }
    const finishPointMove = () => { if (movingPointIndex === null) return; movingPointIndex = null; map.dragPan.enable(); map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '' }
    map.on('mousedown', 'draft-points', (event) => { const index = Number(event.features?.[0]?.properties?.index); if (Number.isFinite(index)) { event.preventDefault(); beginPointMove(index) } })
    map.on('mousemove', (event) => { if (movingPointIndex !== null) onMovePointRef.current(movingPointIndex, [event.lngLat.lng, event.lngLat.lat]) })
    map.on('mouseup', finishPointMove)
    map.on('touchstart', 'draft-points', (event) => {
      const index = Number(event.features?.[0]?.properties?.index)
      if (!Number.isFinite(index)) return
      touchPressTimer = window.setTimeout(() => beginPointMove(index), 420)
    })
    map.on('touchmove', (event) => {
      if (movingPointIndex === null) return
      event.preventDefault()
      onMovePointRef.current(movingPointIndex, [event.lngLat.lng, event.lngLat.lat])
    })
    map.on('touchend', () => { if (touchPressTimer) window.clearTimeout(touchPressTimer); touchPressTimer = undefined; finishPointMove() })
    map.on('mouseenter', 'recommendation-points', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'recommendation-points', () => { map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '' })
    // MapLibre's automatic popup anchor only knows about the canvas edges. On
    // mobile, a bottom sheet covers part of that canvas, so it can choose a
    // downward-facing popup that is immediately hidden behind the sheet.
    // Choose the side with more *actually visible* map space instead.
    const visibleMapBounds = () => {
      const mapRect = map.getContainer().getBoundingClientRect()
      const sheetRects = [...document.querySelectorAll<HTMLElement>('[data-map-occlusion="bottom-sheet"]')]
        .map((sheet) => sheet.getBoundingClientRect())
      return { mapRect, top: mapRect.top + 12, bottom: mapRect.bottom - bottomSheetInset(mapRect, sheetRects) - 12 }
    }
    const popupAnchorInVisibleMap = (point: maplibregl.LngLat) => {
      const { mapRect, top, bottom } = visibleMapBounds()
      const screenY = mapRect.top + map.project(point).y
      return screenY - top >= bottom - screenY ? 'bottom' : 'top'
    }
    const createDraftPopup = (point: maplibregl.LngLat) => new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      anchor: popupAnchorInVisibleMap(point),
    }).setLngLat(point)
    const keepPopupInVisibleMap = (point: maplibregl.LngLat, popup: maplibregl.Popup) => {
      // Let MapLibre create and measure the popup before choosing its final
      // camera position. The available space changes with every sheet snap.
      window.requestAnimationFrame(() => {
        const { top, bottom } = visibleMapBounds()
        const content = popup.getElement()?.querySelector<HTMLElement>('.maplibregl-popup-content')
        if (content) {
          content.style.maxHeight = `${Math.max(150, bottom - top)}px`
          content.style.overflowY = 'auto'
        }
        window.requestAnimationFrame(() => {
          if (draftPopupRef.current !== popup) return
          const element = popup.getElement()
          if (!element) return
          const { mapRect, top: visibleTop, bottom: visibleBottom } = visibleMapBounds()
          const rect = element.getBoundingClientRect()
          const shiftX = rect.left < mapRect.left + 10 ? mapRect.left + 10 - rect.left : rect.right > mapRect.right - 10 ? mapRect.right - 10 - rect.right : 0
          const shiftY = rect.top < visibleTop ? visibleTop - rect.top : rect.bottom > visibleBottom ? visibleBottom - rect.bottom : 0
          if (Math.abs(shiftX) < 1 && Math.abs(shiftY) < 1) return
          const current = map.project(point)
          const target = { x: current.x + shiftX, y: current.y + shiftY }
          const center = map.unproject([mapRect.width / 2 + current.x - target.x, mapRect.height / 2 + current.y - target.y])
          map.easeTo({ center, zoom: map.getZoom(), duration: 280, essential: true })
        })
      })
    }
    const showDraftPopup = (point: maplibregl.LngLat, popup: maplibregl.Popup) => {
      draftPopupRef.current = popup.addTo(map)
      keepPopupInVisibleMap(point, popup)
    }
    map.on('click', 'recommendation-points', (event) => {
      if (!recommendationMapStateRef.current.active) return
      suppressNextMapClick = true
      draftPopupRef.current?.remove()
      const feature = event.features?.[0]
      if (feature?.properties?.role === 'center') {
        showDraftPopup(event.lngLat, createDraftPopup(event.lngLat)
          .setText('探索範囲の中心です。この地点を通る必要はありません。'))
        return
      }
      const role = feature?.properties?.role as 'start' | 'via' | 'goal' | undefined
      const index = Number(feature?.properties?.index)
      const content = document.createElement('div'); content.className = 'draft-point-popup'
      const message = document.createElement('strong'); message.textContent = `${feature?.properties?.label ?? 'この地点'}を削除しますか？`
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除する'
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル'
      remove.addEventListener('click', () => { if (role) onRecommendationMapActionRef.current({ point: [event.lngLat.lng, event.lngLat.lat], action: 'remove', role, index: Number.isFinite(index) ? index : 0 }); draftPopupRef.current?.remove(); draftPopupRef.current = null })
      cancel.addEventListener('click', () => { draftPopupRef.current?.remove(); draftPopupRef.current = null })
      content.append(message, remove, cancel)
      showDraftPopup(event.lngLat, createDraftPopup(event.lngLat).setDOMContent(content))
    })
    map.on('click', (event) => {
      if (suppressNextMapClick) { suppressNextMapClick = false; return }
      if (!drawingRef.current || movingPointIndex !== null) return
      draftPopupRef.current?.remove()
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat]
      const content = document.createElement('div')
      content.className = 'draft-point-popup'
      const hasStart = draftRouteRef.current.length > 0 || draftRolesRef.current.includes('start')
      const actions = mapDraftActions(hasStart, recommendationMapStateRef.current.active)
      const message = document.createElement('strong'); message.textContent = hasStart ? 'この位置をどの地点として追加しますか？' : '最初の地点を始点として追加しますか？'
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル'
      cancel.addEventListener('click', () => { draftPopupRef.current?.remove(); draftPopupRef.current = null })
      content.append(message)
      for (const action of actions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = action === 'start' ? '始点として追加'
          : action === 'via' ? '経由地として追加'
          : action === 'goal' ? 'ゴールとして追加'
          : action === 'recommendation-center' ? '提案の探索中心に設定'
          : '提案の必ず通る地点に追加'
        button.addEventListener('click', () => {
          if (action === 'recommendation-center') onRecommendationMapActionRef.current({ point: coordinate, action: 'center' })
          else if (action === 'recommendation-via') onRecommendationMapActionRef.current({ point: coordinate, action: 'via' })
          else onAddPointRef.current(coordinate, '地図指定', action === 'goal' ? 'goal' : 'via', action === 'via' ? viaInsertAfterRef.current : null)
          draftPopupRef.current?.remove()
          draftPopupRef.current = null
        })
        content.append(button)
      }
      content.append(cancel)
      showDraftPopup(event.lngLat, createDraftPopup(event.lngLat).setDOMContent(content))
    })
    mapRef.current = map
    return () => { if (touchPressTimer) window.clearTimeout(touchPressTimer); draftPopupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
  // Event handlers intentionally use refs above. Recreating the MapLibre map on
  // every parent render interrupts touch interactions, especially long-press drag.
  }, [onCurrentLocationChange])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    ;(map.getSource('courses') as GeoJSONSource | undefined)?.setData(toFeatureCollection(courses, courseColors))
  }, [courseColors, courses, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('search-radius') as GeoJSONSource | undefined)?.setData(toSearchRadius(searchCenter, searchRadiusKm))
  }, [mapReady, searchCenter, searchRadiusKm])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    const builderLayers = ['draft-road-line', 'draft-point-pin-tip', 'draft-points', 'draft-point-labels', 'draft-point-names', 'pending-search-pulse', 'pending-search-pin-tip', 'pending-search-pin', 'pending-search-label', 'recommendation-point-tip', 'recommendation-points', 'recommendation-point-labels']
    const setBuilderVisibility = (visibility: 'visible' | 'none') => builderLayers.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
    })
    if (!drawing) {
      ;(map.getSource('draft-road') as GeoJSONSource | undefined)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } })
      ;(map.getSource('draft-points') as GeoJSONSource | undefined)?.setData(toDraftPointCollection([]))
      ;(map.getSource('pending-search-point') as GeoJSONSource | undefined)?.setData(toPendingSearchPoint(null, ''))
      ;(map.getSource('recommendation-points') as GeoJSONSource | undefined)?.setData(toRecommendationPointCollection({ active: false, start: null, goal: null, vias: [] }))
      // A completed save must never leave builder artefacts behind, even if a
      // late routing response tries to update a GeoJSON source afterwards.
      setBuilderVisibility('none')
      map.getCanvas().style.cursor = ''
      draftPopupRef.current?.remove(); draftPopupRef.current = null
      return
    }
    setBuilderVisibility('visible')
    ;(map.getSource('draft-points') as GeoJSONSource | undefined)?.setData(toDraftPointCollection(draftRoute, draftLabels, draftRoles))
    // A route edit means the search candidate has either been confirmed or the
    // user chose a different point. Clear the map source directly as a second
    // guard; this avoids a stale temporary pin if React updates are batched.
    if (draftRoute.length > 0) (map.getSource('pending-search-point') as GeoJSONSource | undefined)?.setData(toPendingSearchPoint(null, ''))
    map.getCanvas().style.cursor = drawing ? 'crosshair' : ''
  }, [drawing, draftRoute, draftLabels, draftRoles, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('pending-search-point') as GeoJSONSource | undefined)?.setData(toPendingSearchPoint(pendingSearchPoint, pendingSearchLabel))
  }, [mapReady, pendingSearchPoint, pendingSearchLabel])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('recommendation-points') as GeoJSONSource | undefined)?.setData(toRecommendationPointCollection(recommendationMapState))
    // The builder layers may have been hidden during the previous save or
    // sheet transition.  A live finder always restores its own pins, rather
    // than relying on an unrelated draft-route render to do so.
    const visibility = drawing && recommendationMapState.active ? 'visible' : 'none'
    ;['recommendation-point-tip', 'recommendation-points', 'recommendation-point-labels'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
    })
  }, [drawing, mapReady, recommendationMapState])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('current-location') as GeoJSONSource | undefined)?.setData(toCurrentLocation(currentLocation))
  }, [currentLocation, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('draft-road') as GeoJSONSource | undefined
    if (!mapReady || !source) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (!drawing || draftRoute.length < 2) {
        source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } })
        return
      }
      try {
        const routed = await routeAlongRoads(draftRoute)
        if (!cancelled) source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routed.route } })
      } catch {
        if (!cancelled) source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } })
      }
    }, 280)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [drawing, draftRoute, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container || !focusPoint) return
    fitRouteToVisibleMap(map, container, [focusPoint], { top: 34, right: 42, bottom: 34, left: 42 }, 500)
  }, [focusPoint, drawing, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container || !drawing || !draftFitRequest || draftRoute.length < 2) return
    const fitDraft = (animate: boolean) => {
      map.stop()
      map.resize()
      fitRouteToVisibleMap(map, container, draftRoute, { top: 42, right: 52, bottom: 42, left: 52 }, animate ? 650 : 0)
    }
    const first = window.requestAnimationFrame(() => fitDraft(true))
    // The goal-choice dialog closes at the same time as the builder sheet is
    // restored. Refit after that layout settles so the complete composed route
    // remains centred in the map area that is actually visible.
    const settleTimers = [260, 680].map((delay) => window.setTimeout(() => fitDraft(true), delay))
    return () => {
      window.cancelAnimationFrame(first)
      settleTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [draftFitRequest, draftRoute, drawing, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map?.isStyleLoaded() || !container) return
    const source = map.getSource('selected-course') as GeoJSONSource | undefined
    source?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selected?.route ?? [] } })
    ;(map.getSource('selected-contours') as GeoJSONSource | undefined)?.setData(toContourFeatureCollection(selected))
    ;(map.getSource('course-annotations') as GeoJSONSource | undefined)?.setData(toCourseAnnotationCollection(selected))
  }, [selected, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    // A selected course can replace one bottom sheet with another during the
    // same render. Keep camera work in this single effect and refit after the
    // animation settles; competing fitBounds calls were cancelling each other
    // and made the preview button appear to do nothing on mobile.
    if (!map || !container || !focusRequest || !selected || selected.route.length < 2) return
    const fitSelected = (animate: boolean) => {
      const isProposalPreview = selected.authorId === '__proposal_preview__'
      const margin = isProposalPreview ? { top: 52, right: 64, bottom: 52, left: 64 } : { top: 18, right: 42, bottom: 18, left: 42 }
      map.stop()
      map.resize()
      fitRouteToVisibleMap(map, container, selected.route, margin, animate ? 640 : 0)
    }
    // Every selection and proposal preview uses an eased move.  The follow-up
    // passes retain the same behaviour while accommodating the final sheet
    // bounds on iOS/Android, including a maximized builder collapsing into the
    // preview detail sheet.
    const first = window.requestAnimationFrame(() => fitSelected(true))
    const settleTimers = [220, 700].map((delay) => window.setTimeout(() => fitSelected(true), delay))
    return () => {
      window.cancelAnimationFrame(first)
      settleTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [focusRequest, selected, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container || !selected || selected.route.length < 2) return
    let frame = 0
    const alignToVisibleMap = () => {
      frame = 0
      const isProposalPreview = selected.authorId === '__proposal_preview__'
      fitRouteToVisibleMap(map, container, selected.route, isProposalPreview
        ? { top: 52, right: 64, bottom: 52, left: 64 }
        : { top: 18, right: 42, bottom: 18, left: 42 }, 0)
    }
    const scheduleAlignment = () => {
      if (!frame) frame = window.requestAnimationFrame(alignToVisibleMap)
    }
    // All sheets use the same occlusion marker. Observing their class/style
    // changes covers snapping, drag movement, iOS visual-viewport settling,
    // and sheets mounted after a route has been selected.
    const observedSheets = new Set<HTMLElement>()
    const observeSheets = () => {
      document.querySelectorAll<HTMLElement>('[data-map-occlusion="bottom-sheet"]').forEach((sheet) => {
        if (observedSheets.has(sheet)) return
        observedSheets.add(sheet)
        mutations.observe(sheet, { attributes: true, attributeFilter: ['class', 'style'] })
        resize.observe(sheet)
      })
    }
    // Only sheet attributes are relevant. A zero-duration re-fit is used
    // while dragging so the route remains locked to the visible-map centre.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'attributes')) scheduleAlignment()
      if (records.some((record) => record.type === 'childList')) { observeSheets(); scheduleAlignment() }
    })
    mutations.observe(document.body, { childList: true, subtree: true })
    const resize = new ResizeObserver(scheduleAlignment)
    resize.observe(container)
    observeSheets()
    const settleTimers = [0, 240, 620].map((delay) => window.setTimeout(scheduleAlignment, delay))
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      settleTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [selected, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    map.setTerrain(is3d ? { source: 'terrain-dem', exaggeration: 1.45 } : null)
    map.easeTo({ pitch: is3d ? 68 : 0, bearing: is3d ? -18 : 0, duration: 900 })
  }, [is3d])

  if (mapError) return <div className="map map-fallback" role="status"><div><strong>地図を表示できません</strong><p>{mapError}</p><button onClick={() => location.reload()}>再読み込み</button></div></div>
  return <div ref={containerRef} className="map" aria-label="峠コース地図" />
}
