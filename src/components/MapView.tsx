import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Coordinate, Course, DraftPointRole } from '../types'
import { supportsWebGL } from '../lib/webgl'
import { routeAlongRoads } from '../lib/routing'
import { toContourFeatureCollection, toCourseAnnotationCollection } from '../lib/mapOverlays'

interface MapViewProps {
  courses: Course[]
  selected: Course | null
  is3d: boolean
  drawing: boolean
  draftRoute: Coordinate[]
  draftLabels: string[]
  draftRoles: DraftPointRole[]
  viaInsertAfter: number | null
  focusPoint: Coordinate | null
  pendingSearchPoint: Coordinate | null
  pendingSearchLabel: string
  onSelect: (course: Course) => void
  onAddPoint: (point: Coordinate, label?: string, role?: 'via' | 'goal', insertAfter?: number | null) => void
  onMovePoint: (index: number, point: Coordinate) => void
}

const toFeatureCollection = (courses: Course[]) => ({
  type: 'FeatureCollection' as const,
  features: courses.map((course) => ({
    type: 'Feature' as const,
    properties: { id: course.id, name: course.name },
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

/** On phones, centre a searched place in the part of the map that remains
 * visible above the live bottom sheet, rather than behind that sheet. */
function mobileVisibleMapOffset(container: HTMLDivElement) {
  if (!window.matchMedia('(max-width: 760px)').matches) return [0, 0] as [number, number]
  const sheet = document.querySelector<HTMLElement>('.course-form:not(.surface-leaving)')
  if (!sheet) return [0, 0] as [number, number]
  const mapRect = container.getBoundingClientRect()
  const sheetRect = sheet.getBoundingClientRect()
  const visibleBottom = Math.min(mapRect.bottom, Math.max(mapRect.top, sheetRect.top))
  const visibleHeight = visibleBottom - mapRect.top
  if (visibleHeight < 80) return [0, 0] as [number, number]
  return [0, visibleHeight / 2 - mapRect.height / 2] as [number, number]
}

export function MapView({ courses, selected, is3d, drawing, draftRoute, draftLabels, draftRoles, viaInsertAfter, focusPoint, pendingSearchPoint, pendingSearchLabel, onSelect, onAddPoint, onMovePoint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const coursesRef = useRef(courses)
  const drawingRef = useRef(drawing)
  const onAddPointRef = useRef(onAddPoint)
  const onMovePointRef = useRef(onMovePoint)
  const onSelectRef = useRef(onSelect)
  const draftPopupRef = useRef<maplibregl.Popup | null>(null)
  const draftRouteRef = useRef(draftRoute)
  const draftLabelsRef = useRef(draftLabels)
  const draftRolesRef = useRef(draftRoles)
  const viaInsertAfterRef = useRef(viaInsertAfter)
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => { coursesRef.current = courses }, [courses])
  useEffect(() => { drawingRef.current = drawing }, [drawing])
  useEffect(() => { onAddPointRef.current = onAddPoint }, [onAddPoint])
  useEffect(() => { onMovePointRef.current = onMovePoint }, [onMovePoint])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { draftRouteRef.current = draftRoute }, [draftRoute])
  useEffect(() => { draftLabelsRef.current = draftLabels }, [draftLabels])
  useEffect(() => { draftRolesRef.current = draftRoles }, [draftRoles])
  useEffect(() => { viaInsertAfterRef.current = viaInsertAfter }, [viaInsertAfter])

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
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', layout: { visibility: 'none' }, paint: { 'line-color': '#ee704f', 'line-width': 5, 'line-dasharray': [1.2, 1] } })
      map.addSource('draft-road', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({ id: 'draft-road-line', type: 'line', source: 'draft-road', paint: { 'line-color': '#ee704f', 'line-width': 5, 'line-opacity': .9 } })
      map.addSource('draft-points', { type: 'geojson', data: toDraftPointCollection([]) })
      // Keep the draft stops above every course layer.  The small triangular tip
      // makes the otherwise compact numbered marker read as a map pin.
      map.addLayer({ id: 'draft-point-pin-tip', type: 'symbol', source: 'draft-points', layout: { 'text-field': '▼', 'text-size': 19, 'text-offset': [0, .72], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': ['match', ['get', 'label'], 'S', '#287e5a', 'G', '#d35a46', '#e1ac3d'] } })
      map.addLayer({ id: 'draft-points', type: 'circle', source: 'draft-points', paint: { 'circle-radius': 13, 'circle-color': ['match', ['get', 'label'], 'S', '#287e5a', 'G', '#d35a46', '#e1ac3d'], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff8e7' } })
      map.addLayer({ id: 'draft-point-labels', type: 'symbol', source: 'draft-points', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#142018' } })
      map.addLayer({ id: 'draft-point-names', type: 'symbol', source: 'draft-points', layout: { 'text-field': ['concat', ['get', 'label'], '  ', ['get', 'name']], 'text-size': 13, 'text-offset': [0, 2.15], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#15251b', 'text-halo-color': '#fff8e7', 'text-halo-width': 2.5 } })
      map.addSource('pending-search-point', { type: 'geojson', data: toPendingSearchPoint(null, '') })
      map.addLayer({ id: 'pending-search-pulse', type: 'circle', source: 'pending-search-point', paint: { 'circle-radius': 21, 'circle-color': '#e76f51', 'circle-opacity': .2, 'circle-stroke-color': '#d7503d', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': .75 } })
      map.addLayer({ id: 'pending-search-pin-tip', type: 'symbol', source: 'pending-search-point', layout: { 'text-field': '▼', 'text-size': 23, 'text-offset': [0, .74], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#e76f51' } })
      map.addLayer({ id: 'pending-search-pin', type: 'circle', source: 'pending-search-point', paint: { 'circle-radius': 15, 'circle-color': '#e76f51', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff8e7' } })
      map.addLayer({ id: 'pending-search-label', type: 'symbol', source: 'pending-search-point', layout: { 'text-field': ['concat', '仮  ', ['get', 'label']], 'text-size': 13, 'text-offset': [0, 2.35], 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#7f2f27', 'text-halo-color': '#fff8e7', 'text-halo-width': 2.5 } })
      map.addLayer({ id: 'selected-contour-labels', type: 'symbol', source: 'selected-contours', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#3d5b4c', 'text-halo-color': '#f6f1dd', 'text-halo-width': 1.5 } })
      map.addSource('course-annotations', { type: 'geojson', data: toCourseAnnotationCollection(null) })
      map.addLayer({ id: 'course-annotation-points', type: 'circle', source: 'course-annotations', paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'kind'], 'gradient', '#df624a', 'curves', '#d69f35', 'viewpoint', '#4c9ed9', '#4c9b79'], 'circle-stroke-color': '#f6f1dd', 'circle-stroke-width': 1.5 } })
      map.addLayer({ id: 'course-annotation-labels', type: 'symbol', source: 'course-annotations', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -1.25], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd', 'text-halo-width': 2 } })
      ;(map.getSource('draft') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draftRouteRef.current } })
      ;(map.getSource('draft-points') as GeoJSONSource).setData(toDraftPointCollection(draftRouteRef.current, draftLabelsRef.current, draftRolesRef.current))
      setMapReady(true)
    })

    map.on('mouseenter', 'courses-line', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'courses-line', () => { map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '' })
    map.on('click', 'courses-line', (event) => {
      if (drawingRef.current) return
      const id = event.features?.[0]?.properties?.id as string | undefined
      const course = coursesRef.current.find((item) => item.id === id)
      if (course) onSelectRef.current(course)
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
    map.on('click', (event) => {
      if (suppressNextMapClick) { suppressNextMapClick = false; return }
      if (!drawingRef.current || movingPointIndex !== null) return
      draftPopupRef.current?.remove()
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat]
      const content = document.createElement('div')
      content.className = 'draft-point-popup'
      const isFirstStop = draftRolesRef.current.length === 0
      const message = document.createElement('strong'); message.textContent = isFirstStop ? '最初の地点を始点として追加しますか？' : 'この位置を経由地またはゴールとして追加しますか？'
      const via = document.createElement('button'); via.type = 'button'; via.textContent = isFirstStop ? '始点として追加' : '経由地として追加'
      const goal = document.createElement('button'); goal.type = 'button'; goal.textContent = 'ゴールとして追加'
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル'
      via.addEventListener('click', () => { onAddPointRef.current(coordinate, '地図指定', 'via', viaInsertAfterRef.current); draftPopupRef.current?.remove(); draftPopupRef.current = null })
      goal.addEventListener('click', () => { onAddPointRef.current(coordinate, '地図指定', 'goal'); draftPopupRef.current?.remove(); draftPopupRef.current = null })
      cancel.addEventListener('click', () => { draftPopupRef.current?.remove(); draftPopupRef.current = null })
      content.append(message, via)
      if (!isFirstStop) content.append(goal)
      content.append(cancel)
      draftPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 }).setLngLat(event.lngLat).setDOMContent(content).addTo(map)
    })
    mapRef.current = map
    return () => { if (touchPressTimer) window.clearTimeout(touchPressTimer); draftPopupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
  // Event handlers intentionally use refs above. Recreating the MapLibre map on
  // every parent render interrupts touch interactions, especially long-press drag.
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('courses') as GeoJSONSource | undefined)?.setData(toFeatureCollection(courses))
  }, [courses, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    const source = map.getSource('draft') as GeoJSONSource | undefined
    source?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draftRoute } })
    ;(map.getSource('draft-points') as GeoJSONSource | undefined)?.setData(toDraftPointCollection(draftRoute, draftLabels, draftRoles))
    // A route edit means the search candidate has either been confirmed or the
    // user chose a different point. Clear the map source directly as a second
    // guard; this avoids a stale temporary pin if React updates are batched.
    if (draftRoute.length > 0) (map.getSource('pending-search-point') as GeoJSONSource | undefined)?.setData(toPendingSearchPoint(null, ''))
    map.getCanvas().style.cursor = drawing ? 'crosshair' : ''
    if (!drawing) { draftPopupRef.current?.remove(); draftPopupRef.current = null }
  }, [drawing, draftRoute, draftLabels, draftRoles, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.isStyleLoaded()) return
    ;(map.getSource('pending-search-point') as GeoJSONSource | undefined)?.setData(toPendingSearchPoint(pendingSearchPoint, pendingSearchLabel))
  }, [mapReady, pendingSearchPoint, pendingSearchLabel])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('draft-road') as GeoJSONSource | undefined
    if (!mapReady || !source) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (draftRoute.length < 2) {
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
  }, [draftRoute, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container || !focusPoint) return
    map.flyTo({ center: focusPoint, offset: mobileVisibleMapOffset(container), zoom: Math.max(map.getZoom(), 15), duration: 500, essential: true })
  }, [focusPoint, drawing])

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
