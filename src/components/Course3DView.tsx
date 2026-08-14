import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinate, Course } from '../types'
import { supportsWebGL } from '../lib/webgl'
import { toContourFeatureCollection, toCourseAnnotationCollection } from './MapView'

type ViewMode = 'overview' | 'preview' | 'model'

function pointAt(route: Coordinate[], progress: number): Coordinate {
  const index = Math.min(route.length - 1, Math.max(0, Math.round(progress * (route.length - 1))))
  return route[index]
}

function elevationAt(values: number[], progress: number): number {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.max(0, Math.round(progress * (values.length - 1))))]
}

function smoothValue(before: number, start: number, end: number, after: number, amount: number): number {
  const amount2 = amount * amount; const amount3 = amount2 * amount
  return .5 * ((2 * start) + (-before + end) * amount + (2 * before - 5 * start + 4 * end - after) * amount2 + (-before + 3 * start - 3 * end + after) * amount3)
}

function interpolatedPointAt(route: Coordinate[], progress: number): Coordinate {
  const position = Math.min(route.length - 1, Math.max(0, progress * (route.length - 1)))
  const index = Math.floor(position); const amount = position - index
  const before = route[Math.max(0, index - 1)]; const start = route[index]
  const end = route[Math.min(route.length - 1, index + 1)]; const after = route[Math.min(route.length - 1, index + 2)]
  return [smoothValue(before[0], start[0], end[0], after[0], amount), smoothValue(before[1], start[1], end[1], after[1], amount)]
}

function interpolatedElevationAt(values: number[], progress: number): number {
  const position = Math.min(values.length - 1, Math.max(0, progress * (values.length - 1)))
  const index = Math.floor(position); const amount = position - index
  return smoothValue(values[Math.max(0, index - 1)], values[index], values[Math.min(values.length - 1, index + 1)], values[Math.min(values.length - 1, index + 2)], amount)
}

type Point3 = [number, number, number]
type Point2 = [number, number]
type ModelView = { yaw: number; pitch: number; zoom: number; pan: Point2 }

function projectPoint([x, y, z]: Point3, yaw: number, pitch: number, zoom = 1, [panX, panY]: Point2 = [0, 0]): Point2 {
  const yawRad = (yaw * Math.PI) / 180
  const pitchRad = (pitch * Math.PI) / 180
  const rotatedX = x * Math.cos(yawRad) - y * Math.sin(yawRad)
  const depth = x * Math.sin(yawRad) + y * Math.cos(yawRad)
  return [500 + panX + rotatedX * zoom, 365 + panY + (depth * Math.sin(pitchRad) - z * Math.cos(pitchRad)) * zoom]
}

function viewDepth([x, y]: Point3, yaw: number): number {
  const yawRad = (yaw * Math.PI) / 180
  return x * Math.sin(yawRad) + y * Math.cos(yawRad)
}

function pointsText(points: Point2[]): string { return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }
function wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180 }
function angleBetween(first: { x: number; y: number }, second: { x: number; y: number }): number { return Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI }

export function Course3DView({ course, courses, onClose }: { course: Course; courses: Course[]; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const progressMarkerRef = useRef<Marker | null>(null)
  const modelDragRef = useRef<{ pointerId: number; x: number; y: number; pan: Point2; scale: number } | null>(null)
  const modelPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; angle: number; zoom: number; x: number; y: number; yaw: number; pitch: number } | null>(null)
  const touchPinchRef = useRef<{ distance: number; angle: number; zoom: number; y: number; yaw: number; pitch: number } | null>(null)
  // Gestures can emit far more events than a phone can paint. Keep one canonical
  // view state and commit only the most recent input once per animation frame.
  // This also prevents a queued zoom from overwriting a later reset/preset.
  const modelViewRef = useRef<ModelView>({ yaw: 0, pitch: 49, zoom: 1.15, pan: [0, 0] })
  const modelViewFrameRef = useRef<number | null>(null)
  const pendingModelViewRef = useRef<ModelView | null>(null)
  const [mode, setMode] = useState<ViewMode>('overview')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [modelYaw, setModelYaw] = useState(0)
  const [modelPitch, setModelPitch] = useState(49)
  const [modelZoom, setModelZoom] = useState(1.15)
  const [modelPan, setModelPan] = useState<Point2>([0, 0])
  const [activeLandmark, setActiveLandmark] = useState<{ name: string; progress: number; type?: string } | null>(null)
  const [compareCourseId, setCompareCourseId] = useState('')
  const [exaggeration, setExaggeration] = useState(1.5)
  const [mapError, setMapError] = useState('')
  const [compactModel, setCompactModel] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const profile = useMemo(() => course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation], [course.elevationProfile, course.maxElevation, course.minElevation])
  const currentElevation = elevationAt(profile, progress)
  const currentPoint = pointAt(course.route, progress)
  const model = useMemo(() => {
    // Keep each ribbon segment short even on long courses.  This makes the
    // individual joints substantially smaller while retaining a smooth route.
    // Mobile GPUs can reliably render a slightly smaller but still fine-grained mesh.
    // This avoids rebuilding thousands of SVG faces for every pinch-move frame.
    const sampleCount = compactModel
      ? Math.min(520, Math.max(360, course.route.length * 2))
      : Math.min(900, Math.max(480, course.route.length * 3))
    const sampled = Array.from({ length: sampleCount }, (_, index) => {
      const progress = index / Math.max(1, sampleCount - 1)
      return { point: interpolatedPointAt(course.route, progress), elevation: interpolatedElevationAt(profile, progress) }
    })
    const lngs = sampled.map(({ point }) => point[0]); const lats = sampled.map(({ point }) => point[1])
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2; const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
    const elevationMin = Math.min(...profile); const elevationRange = Math.max(1, Math.max(...profile) - elevationMin)
    // Keep the plan scale tied to real-world kilometres.  Previously each bounding
    // box was normalised to the same 600×420 space, so a 40 km road looked almost
    // exactly like a 9 km road.  Longer routes now begin smaller; only an overflow
    // safety fit is applied afterwards.
    const kmPerLongitude = 111.32 * Math.cos((centerLat * Math.PI) / 180)
    const sceneScale = 620 / Math.max(5, course.distanceKm)
    // Preserve the terrain character without allowing a steep short course's
    // vertical exaggeration to defeat its distance-based plan scale.
    const verticalScale = Math.min(160, Math.max(60, (elevationRange / Math.max(1, course.distanceKm)) * 3.5))
    const centers: Point3[] = sampled.map(({ point, elevation }) => [
      (point[0] - centerLng) * kmPerLongitude * sceneScale,
      (point[1] - centerLat) * 111.32 * sceneScale,
      ((elevation - elevationMin) / elevationRange) * verticalScale,
    ])
    // A narrower ribbon and no segment outline prevent the high-resolution mesh
    // from looking like a chain of oversized dots.
    const width = 5.5; const thickness = 9
    const left: Point3[] = []; const right: Point3[] = []
    centers.forEach((point, index) => {
      const before = centers[Math.max(0, index - 1)]; const after = centers[Math.min(centers.length - 1, index + 1)]
      const dx = after[0] - before[0]; const dy = after[1] - before[1]; const length = Math.max(1, Math.hypot(dx, dy))
      const offsetX = (-dy / length) * width; const offsetY = (dx / length) * width
      left.push([point[0] + offsetX, point[1] + offsetY, point[2]])
      right.push([point[0] - offsetX, point[1] - offsetY, point[2]])
    })
    // Start is deliberately placed at the lower-left and the goal at the upper-right
    // on first view, independent of the geographic direction of the road.
    const routeHeading = Math.atan2(centers.at(-1)![1] - centers[0][1], centers.at(-1)![0] - centers[0][0]) * 180 / Math.PI
    const defaultYaw = wrapDegrees(-routeHeading - 35)
    const defaultProjection = [...left, ...right].map((point) => projectPoint(point, defaultYaw, 49))
    const xExtent = Math.max(...defaultProjection.map(([x]) => x)) - Math.min(...defaultProjection.map(([x]) => x))
    const yExtent = Math.max(...defaultProjection.map(([, y]) => y)) - Math.min(...defaultProjection.map(([, y]) => y))
    // Never enlarge a short route merely to fill the canvas.  The fit only prevents
    // a long / tall route from being clipped, retaining meaningful distance scaling.
    const autoFit = Math.min(1, .96 * Math.min(830 / Math.max(1, xExtent), 310 / Math.max(1, yExtent)))
    return { centers, left, right, thickness, autoFit, defaultYaw }
  }, [compactModel, course.distanceKm, course.route, profile])
  const effectiveZoom = model.autoFit * modelZoom

  useEffect(() => {
    applyModelView({ yaw: model.defaultYaw, pitch: 49, zoom: 1.15, pan: [0, 0] }, true)
  }, [course.id, model.defaultYaw])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setCompactModel(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => () => { if (modelViewFrameRef.current) window.cancelAnimationFrame(modelViewFrameRef.current) }, [])
  const modelFaces = useMemo(() => {
    const faces: { points: string; color: string; depth: number }[] = []
    const addFace = (points: Point3[], color: string) => {
      faces.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), color, depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw), 0) / points.length })
    }
    model.left.slice(1).forEach((_, index) => {
      const i = index + 1
      const leftBefore = model.left[i - 1]; const leftNow = model.left[i]
      const rightBefore = model.right[i - 1]; const rightNow = model.right[i]
      const leftUnder: Point3 = [leftNow[0], leftNow[1], leftNow[2] - model.thickness]
      const leftBeforeUnder: Point3 = [leftBefore[0], leftBefore[1], leftBefore[2] - model.thickness]
      const rightUnder: Point3 = [rightNow[0], rightNow[1], rightNow[2] - model.thickness]
      const rightBeforeUnder: Point3 = [rightBefore[0], rightBefore[1], rightBefore[2] - model.thickness]
      // The route's visible surface is rendered as fine dots below. Keep only
      // a very thin closed underside so the line does not look like chunky tiles.
      addFace([rightBefore, rightNow, rightUnder, rightBeforeUnder], '#07100c')
      addFace([leftNow, leftBefore, leftBeforeUnder, leftUnder], '#10261b')
      addFace([leftBeforeUnder, rightBeforeUnder, rightUnder, leftUnder], '#050a07')
    })
    const startLeft = model.left[0]; const startRight = model.right[0]; const endLeft = model.left.at(-1)!; const endRight = model.right.at(-1)!
    addFace([startLeft, startRight, [startRight[0], startRight[1], startRight[2] - model.thickness], [startLeft[0], startLeft[1], startLeft[2] - model.thickness]], '#122d20')
    addFace([endRight, endLeft, [endLeft[0], endLeft[1], endLeft[2] - model.thickness], [endRight[0], endRight[1], endRight[2] - model.thickness]], '#122d20')
    return faces.sort((a, b) => a.depth - b.depth)
  }, [effectiveZoom, model, modelPan, modelPitch, modelYaw])
  const terrainFaces = useMemo(() => {
    const xs = model.centers.map(([x]) => x); const ys = model.centers.map(([, y]) => y)
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const span = Math.max(180, maxX - minX, maxY - minY)
    const gridSize = 10; const terrain: Point3[][] = []
    for (let row = 0; row <= gridSize; row += 1) {
      terrain[row] = []
      for (let column = 0; column <= gridSize; column += 1) {
        const x = minX - span * .35 + (span * 1.7 * column) / gridSize
        const y = minY - span * .35 + (span * 1.7 * row) / gridSize
        let nearest = model.centers[0]; let nearestDistance = Infinity
        model.centers.forEach((point) => {
          const distance = Math.hypot(point[0] - x, point[1] - y)
          if (distance < nearestDistance) { nearestDistance = distance; nearest = point }
        })
        const falloff = Math.max(0, 1 - nearestDistance / (span * .75))
        const ripple = Math.sin(x * .035 + y * .019) * 5 + Math.cos(y * .041 - x * .013) * 4
        terrain[row][column] = [x, y, Math.max(-25, nearest[2] * (.18 + falloff * .72) + ripple - 13)]
      }
    }
    const faces: { points: string; depth: number }[] = []
    for (let row = 1; row <= gridSize; row += 1) for (let column = 1; column <= gridSize; column += 1) {
      const points = [terrain[row - 1][column - 1], terrain[row - 1][column], terrain[row][column], terrain[row][column - 1]]
      faces.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw), 0) / points.length })
    }
    return faces.sort((a, b) => a.depth - b.depth)
  }, [effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const modelLinePoints = useMemo(() => pointsText(model.centers.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), [effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const modelStart = projectPoint(model.centers[0], modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelEnd = projectPoint(model.centers.at(-1)!, modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelCurrent = projectPoint(model.centers[Math.min(model.centers.length - 1, Math.round(progress * (model.centers.length - 1)))], modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelLandmarks = useMemo(() => {
    const landmarks = course.landmarks?.length ? course.landmarks : [
      { name: `約${(course.distanceKm * .25).toFixed(1)}km`, progress: .25, type: 'place' as const },
      { name: `約${(course.distanceKm * .5).toFixed(1)}km`, progress: .5, type: 'place' as const },
      { name: `約${(course.distanceKm * .75).toFixed(1)}km`, progress: .75, type: 'place' as const },
    ]
    return landmarks.map((landmark) => {
      const pointIndex = Math.min(model.centers.length - 1, Math.max(0, Math.round(landmark.progress * (model.centers.length - 1))))
      const point = model.centers[pointIndex]
      const [x, y] = projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)
      const labelOnLeft = x > 580
      return { ...landmark, x, y, labelX: x + (labelOnLeft ? -12 : 12), labelY: y - 12, labelOnLeft }
    })
  }, [course.distanceKm, course.landmarks, effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const visibleLandmarks = useMemo(() => {
    const limit = effectiveZoom < .9 ? 2 : effectiveZoom < 1.35 ? 3 : modelLandmarks.length
    return modelLandmarks.filter((_, index) => index < limit)
  }, [effectiveZoom, modelLandmarks])
  const distanceMarkers = useMemo(() => {
    const markers: { distance: number; x: number; y: number }[] = []
    for (let distance = 5; distance < course.distanceKm; distance += 5) {
      const point = model.centers[Math.round((distance / course.distanceKm) * (model.centers.length - 1))]
      const [x, y] = projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)
      markers.push({ distance, x, y })
    }
    return markers
  }, [course.distanceKm, effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const gradeSegments = useMemo(() => model.centers.slice(1).map((point, index) => {
    const before = model.centers[index]
    const gradient = point[2] - before[2]
    const color = gradient > .35 ? '#e86a4d' : gradient < -.35 ? '#54a8f7' : '#54bd86'
    return { points: pointsText([projectPoint(before, modelYaw, modelPitch, effectiveZoom, modelPan), projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)]), color }
  }), [effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const highlights = useMemo(() => {
    const entries = [
      { key: 'gradient', label: '急勾配', color: '#e86a4d', progress: 0 },
      { key: 'curves', label: '連続カーブ', color: '#f2d16b', progress: 0 },
      { key: 'view', label: '展望区間', color: '#78c4ff', progress: .72 },
    ]
    let steepest = 0; let steepIndex = 0; let curveScore = 0; let curveIndex = 0
    for (let index = 1; index < model.centers.length - 1; index += 1) {
      const a = model.centers[index - 1]; const b = model.centers[index]; const c = model.centers[index + 1]
      const steep = Math.abs(c[2] - a[2]); if (steep > steepest) { steepest = steep; steepIndex = index }
      const vx = b[0] - a[0]; const vy = b[1] - a[1]; const wx = c[0] - b[0]; const wy = c[1] - b[1]
      const bend = Math.abs(vx * wy - vy * wx); if (bend > curveScore) { curveScore = bend; curveIndex = index }
    }
    entries[0].progress = steepIndex / Math.max(1, model.centers.length - 1)
    entries[1].progress = curveIndex / Math.max(1, model.centers.length - 1)
    return entries.map((entry) => ({ ...entry, point: model.centers[Math.round(entry.progress * (model.centers.length - 1))] }))
  }, [model.centers])
  const comparedCourse = courses.find((item) => item.id === compareCourseId)

  useEffect(() => {
    if (!containerRef.current) return
    if (!supportsWebGL()) { setMapError('この端末ではWebGL地形を利用できません。'); return }
    let map: MapLibreMap
    try {
      map = new maplibregl.Map({ container: containerRef.current, style: 'https://tiles.openfreemap.org/styles/liberty', center: course.route[Math.floor(course.route.length / 2)], zoom: 11, pitch: 70, bearing: -28, maxPitch: 85, attributionControl: false })
    } catch { setMapError('3D地図を初期化できませんでした。'); return }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => {
      map.addSource('terrain-dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 15 })
      map.addLayer({ id: 'terrain-hillshade', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-exaggeration': .34, 'hillshade-shadow-color': '#42574d', 'hillshade-highlight-color': '#f6f1dd', 'hillshade-accent-color': '#718477' } })
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 })
      map.addSource('course-contours', { type: 'geojson', data: toContourFeatureCollection(course) })
      map.addLayer({ id: 'course-contours', type: 'line', source: 'course-contours', paint: { 'line-color': '#637e70', 'line-width': 1.2, 'line-opacity': .62, 'line-dasharray': [1, 2] } })
      map.addLayer({ id: 'course-contour-labels', type: 'symbol', source: 'course-contours', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#3d5b4c', 'text-halo-color': '#f6f1dd', 'text-halo-width': 1.5 } })
      map.addSource('course-annotations', { type: 'geojson', data: toCourseAnnotationCollection(course) })
      map.addLayer({ id: 'course-annotation-points', type: 'circle', source: 'course-annotations', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'gradient', '#df624a', 'curves', '#d69f35', 'viewpoint', '#4c9ed9', '#4c9b79'], 'circle-stroke-color': '#f6f1dd', 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'course-annotation-labels', type: 'symbol', source: 'course-annotations', layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd', 'text-halo-width': 2 } })
      map.addSource('selected-course', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: course.route } } })
      map.addLayer({ id: 'route-glow', type: 'line', source: 'selected-course', paint: { 'line-color': '#101915', 'line-width': 11, 'line-opacity': .55 } })
      map.addLayer({ id: 'route-main', type: 'line', source: 'selected-course', paint: { 'line-color': '#f2d16b', 'line-width': 6 } })
      new maplibregl.Marker({ color: '#2d795a' }).setLngLat(course.route[0]).setPopup(new maplibregl.Popup().setText('START')).addTo(map)
      new maplibregl.Marker({ color: '#d3523c' }).setLngLat(course.route.at(-1)!).setPopup(new maplibregl.Popup().setText('GOAL')).addTo(map)
      progressMarkerRef.current = new maplibregl.Marker({ color: '#fff', scale: .8 }).setLngLat(course.route[0]).addTo(map)
      const bounds = course.route.reduce((value, point) => value.extend(point), new maplibregl.LngLatBounds(course.route[0], course.route[0]))
      map.fitBounds(bounds, { padding: 90, pitch: 70, bearing: -28, maxZoom: 13, duration: 1200 })
    })
    mapRef.current = map
    return () => { progressMarkerRef.current?.remove(); progressMarkerRef.current = null; map.remove() }
  }, [course])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getSource('terrain-dem')) map.setTerrain({ source: 'terrain-dem', exaggeration })
  }, [exaggeration])

  useEffect(() => {
    if (!playing || mode !== 'preview') return
    const timer = window.setInterval(() => setProgress((value) => {
      if (value >= 1) { setPlaying(false); return 1 }
      return Math.min(1, value + 0.004)
    }), 80)
    return () => window.clearInterval(timer)
  }, [playing, mode])

  useEffect(() => {
    progressMarkerRef.current?.setLngLat(currentPoint)
    const map = mapRef.current
    if (mode === 'preview' && map && playing) {
      const next = pointAt(course.route, Math.min(1, progress + .01))
      const bearing = (Math.atan2(next[0] - currentPoint[0], next[1] - currentPoint[1]) * 180) / Math.PI
      map.easeTo({ center: currentPoint, bearing, pitch: 68, duration: 180 })
    }
  }, [currentPoint, course.route, mode, playing, progress])

  function resetView() {
    const map = mapRef.current; if (!map) return
    const bounds = course.route.reduce((value, point) => value.extend(point), new maplibregl.LngLatBounds(course.route[0], course.route[0]))
    map.fitBounds(bounds, { padding: 90, pitch: 70, bearing: -28, maxZoom: 13, duration: 900 })
  }

  function selectProgress(value: number) {
    setProgress(value)
    if (mode === 'preview') setPlaying(false)
  }

  function applyModelView(next: Partial<ModelView>, immediately = false) {
    const base = pendingModelViewRef.current ?? modelViewRef.current
    const view: ModelView = {
      yaw: next.yaw === undefined ? base.yaw : wrapDegrees(next.yaw),
      pitch: next.pitch === undefined ? base.pitch : Math.min(89, Math.max(-89, next.pitch)),
      // Keep a generous close-inspection range while still bounding SVG coordinates.
      // Long courses start with a smaller automatic fit, so 80× preserves a
      // genuinely close view even after that fit has been applied.
      zoom: next.zoom === undefined ? base.zoom : Math.min(80, Math.max(.1, next.zoom)),
      pan: next.pan === undefined ? base.pan : next.pan,
    }
    modelViewRef.current = view
    pendingModelViewRef.current = view
    if (immediately) {
      if (modelViewFrameRef.current) window.cancelAnimationFrame(modelViewFrameRef.current)
      modelViewFrameRef.current = null
      pendingModelViewRef.current = null
      setModelYaw(view.yaw); setModelPitch(view.pitch); setModelZoom(view.zoom); setModelPan(view.pan)
      return
    }
    if (modelViewFrameRef.current) return
    modelViewFrameRef.current = window.requestAnimationFrame(() => {
      modelViewFrameRef.current = null
      const latest = pendingModelViewRef.current
      pendingModelViewRef.current = null
      if (!latest) return
      setModelYaw(latest.yaw); setModelPitch(latest.pitch); setModelZoom(latest.zoom); setModelPan(latest.pan)
    })
  }

  function startModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic pointer events may not be capturable. */ }
    modelPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (modelPointersRef.current.size === 1) {
      const rect = event.currentTarget.getBoundingClientRect()
      // Google Maps-style: one finger moves the map without changing its view.
      modelDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan: modelViewRef.current.pan, scale: 1000 / Math.max(1, rect.width) }
      pinchRef.current = null
      return
    }
    if (modelPointersRef.current.size === 2) {
      const [first, second] = [...modelPointersRef.current.values()]
      pinchRef.current = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), angle: angleBetween(first, second), zoom: modelViewRef.current.zoom, x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, yaw: modelViewRef.current.yaw, pitch: modelViewRef.current.pitch }
      modelDragRef.current = null
    }
  }

  function moveModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!modelPointersRef.current.has(event.pointerId)) return
    modelPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (modelPointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...modelPointersRef.current.values()]
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
      scheduleModelZoom(pinchRef.current.zoom * (distance / pinchRef.current.distance))
      const angleDelta = wrapDegrees(angleBetween(first, second) - pinchRef.current.angle)
      const centerY = (first.y + second.y) / 2
      // Two fingers rotate and tilt, matching Google Maps' 3D gesture model.
      applyModelView({ yaw: pinchRef.current.yaw + angleDelta, pitch: pinchRef.current.pitch + (centerY - pinchRef.current.y) * .35 })
      return
    }
    const drag = modelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyModelView({ pan: [drag.pan[0] + (event.clientX - drag.x) * drag.scale, drag.pan[1] + (event.clientY - drag.y) * drag.scale] })
  }

  function endModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    modelPointersRef.current.delete(event.pointerId)
    if (modelPointersRef.current.size < 2) pinchRef.current = null
    if (modelDragRef.current?.pointerId === event.pointerId) modelDragRef.current = null
    // Continue rotating naturally with the finger that remains after a pinch.
    if (modelPointersRef.current.size === 1) {
      const [pointerId, pointer] = [...modelPointersRef.current.entries()][0]
      const rect = event.currentTarget.getBoundingClientRect()
      modelDragRef.current = { pointerId, x: pointer.x, y: pointer.y, pan: modelViewRef.current.pan, scale: 1000 / Math.max(1, rect.width) }
    }
  }

  function touchDistance(touches: { length: number; [index: number]: { clientX: number; clientY: number } }): number {
    if (touches.length < 2) return 0
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  }

  // Some installed-web-app WebViews do not reliably forward a second PointerEvent
  // to SVG. Keep a native touch fallback so pinch remains available there too.
  function startModelTouch(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length !== 2) return
    // Pointer events are the primary path. This fallback is only for installed
    // WebViews which fail to deliver a second pointer to the SVG.
    if (modelPointersRef.current.size) return
    const first = { x: event.touches[0].clientX, y: event.touches[0].clientY }; const second = { x: event.touches[1].clientX, y: event.touches[1].clientY }
    touchPinchRef.current = { distance: Math.max(1, touchDistance(event.touches)), angle: angleBetween(first, second), zoom: modelViewRef.current.zoom, y: (first.y + second.y) / 2, yaw: modelViewRef.current.yaw, pitch: modelViewRef.current.pitch }
  }

  function moveModelTouch(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length !== 2 || !touchPinchRef.current || modelPointersRef.current.size) return
    scheduleModelZoom(touchPinchRef.current.zoom * (touchDistance(event.touches) / touchPinchRef.current.distance))
    const first = { x: event.touches[0].clientX, y: event.touches[0].clientY }; const second = { x: event.touches[1].clientX, y: event.touches[1].clientY }
    applyModelView({ yaw: touchPinchRef.current.yaw + wrapDegrees(angleBetween(first, second) - touchPinchRef.current.angle), pitch: touchPinchRef.current.pitch + (((first.y + second.y) / 2) - touchPinchRef.current.y) * .35 })
  }

  function endModelTouch(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length < 2) touchPinchRef.current = null
  }

  function scheduleModelZoom(nextZoom: number) {
    applyModelView({ zoom: nextZoom })
  }

  function zoomModel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault()
    scheduleModelZoom(modelViewRef.current.zoom * (event.deltaY > 0 ? .9 : 1.1))
  }

  return (
    <div className={`three-d-modal three-d-mode-${mode}`} role="dialog" aria-modal="true" aria-labelledby="three-d-title">
      <div ref={containerRef} className="three-d-map" aria-label={`${course.name}の3D地形`} />
      {mapError && <div className="three-d-error"><strong>3D表示を利用できません</strong><p>{mapError}</p><button onClick={onClose}>詳細へ戻る</button></div>}
      <header className="three-d-header"><div><p className="eyebrow">3D COURSE PREVIEW</p><h2 id="three-d-title">{course.name}</h2><span>ルートの見え方を切り替えできます</span></div><button className="icon-button" onClick={onClose} aria-label="3D表示を閉じる">×</button></header>
      <nav className="three-d-tabs" aria-label="3D表示モード">
        {([['overview', '俯瞰'], ['preview', '走行プレビュー'], ['model', '3Dルート模型']] as [ViewMode, string][]).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); if (value !== 'preview') setPlaying(false) }}>{label}</button>)}
      </nav>
      {mode === 'preview' && <section className="preview-panel" aria-label="走行プレビュー操作"><div><strong>{Math.round(progress * 100)}%</strong><span>{currentElevation}m · 残り {((1 - progress) * course.distanceKm).toFixed(1)}km</span></div><input aria-label="走行プレビュー位置" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => selectProgress(Number(event.target.value))} /><button onClick={() => { if (progress >= 1) setProgress(0); setPlaying((value) => !value) }}>{playing ? '一時停止' : progress >= 1 ? '最初から' : '再生'}</button></section>}
      {mode === 'model' && <section className="route-model-panel" aria-label="3Dルート模型">
        <div className="model-tools"><div className="model-preset-buttons"><button onClick={() => applyModelView({ yaw: model.defaultYaw, pitch: 49, zoom: 1.15, pan: [0, 0] })}>全体</button><button onClick={() => applyModelView({ yaw: model.defaultYaw, pitch: 8, zoom: 1.45, pan: [0, 0] })}>横から</button><button onClick={() => applyModelView({ yaw: model.defaultYaw + 35, pitch: 62, zoom: 1.25, pan: [0, 0] })}>進行方向</button><button onClick={() => applyModelView({ yaw: model.defaultYaw - 55, pitch: 72, zoom: 1.35, pan: [0, 0] })}>カーブ</button></div></div>
        <svg className="route-model-canvas" viewBox="0 0 1000 480" role="img" aria-label={`${course.name}の3Dルート模型。1本指で平行移動、2本指で拡大縮小・回転・俯角調整ができます。`} onPointerDown={startModelDrag} onPointerMove={moveModelDrag} onPointerUp={endModelDrag} onPointerCancel={endModelDrag} onTouchStart={startModelTouch} onTouchMove={moveModelTouch} onTouchEnd={endModelTouch} onTouchCancel={endModelTouch} onWheel={zoomModel}>
          <defs><linearGradient id="terrain-wash" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#86c7a4" stopOpacity=".32" /><stop offset="1" stopColor="#183f2d" stopOpacity=".1" /></linearGradient><linearGradient id="model-route-line" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#45ba7d" /><stop offset=".52" stopColor="#f2d16b" /><stop offset="1" stopColor="#df624a" /></linearGradient></defs>
          <g className="model-terrain">{terrainFaces.map((face, index) => <polygon key={index} points={face.points} fill="url(#terrain-wash)" />)}</g><g className="model-ribbon">{modelFaces.map((face, index) => <polygon key={index} points={face.points} fill={face.color} />)}</g>
          <polyline className="model-route-line-glow" points={modelLinePoints} />
          <g className="model-grade-line">{gradeSegments.map((segment, index) => <polyline key={index} points={segment.points} stroke={segment.color} />)}</g>
          <circle className="route-travel-dot" r="7" fill="#fff"><animateMotion dur="6s" repeatCount="indefinite" path={`M ${modelLinePoints.replaceAll(' ', ' L ')}`} /></circle>
          {distanceMarkers.map((marker) => <g className="distance-marker" key={marker.distance}><circle cx={marker.x} cy={marker.y} r="4" /><text x={marker.x + 8} y={marker.y - 8}>{marker.distance}km</text></g>)}
          {highlights.map((item) => { const [x, y] = projectPoint(item.point, modelYaw, modelPitch, effectiveZoom, modelPan); return <g className="route-highlight" key={item.key}><circle cx={x} cy={y} r="9" stroke={item.color} /><text x={x + 12} y={y + 5}>{item.label}</text></g> })}
          {visibleLandmarks.map((landmark) => <g className={`model-landmark ${landmark.type ?? 'place'}`} key={`${landmark.name}-${landmark.progress}`} role="button" tabIndex={0} aria-label={`${landmark.name}の地点情報を開く`} onPointerDown={(event) => { event.stopPropagation(); setActiveLandmark(landmark) }} onClick={(event) => { event.stopPropagation(); setActiveLandmark(landmark) }}><circle cx={landmark.x} cy={landmark.y} r="7" /><line x1={landmark.x} y1={landmark.y} x2={landmark.labelX} y2={landmark.labelY + 3} /><text x={landmark.labelX} y={landmark.labelY} textAnchor={landmark.labelOnLeft ? 'end' : 'start'}>{landmark.name}</text></g>)}
          <circle className="model-current" cx={modelCurrent[0]} cy={modelCurrent[1]} r="6" fill="#fff" stroke="#101915" strokeWidth="2" /><text x={modelStart[0] - 32} y={modelStart[1] + 38}>START</text><text x={modelStart[0] - 42} y={modelStart[1] + 59}>{profile[0]}m</text><text x={modelEnd[0] - 26} y={modelEnd[1] - 27}>GOAL</text><text x={modelEnd[0] - 31} y={modelEnd[1] - 7}>{profile.at(-1)}m</text><text x="410" y="455">距離 {course.distanceKm}km</text>
        </svg>
        <div className="model-bottom-panels"><section className="compare-panel"><label>コース比較 <select value={compareCourseId} onChange={(event) => setCompareCourseId(event.target.value)}><option value="">選択…</option>{courses.filter((item) => item.id !== course.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{comparedCourse && <p><b>{course.name}</b> {course.distanceKm}km / {course.maxElevation - course.minElevation}m<br /><b>{comparedCourse.name}</b> {comparedCourse.distanceKm}km / {comparedCourse.maxElevation - comparedCourse.minElevation}m</p>}</section></div>
        {activeLandmark && <aside className="landmark-card"><button onClick={() => setActiveLandmark(null)} aria-label="地点情報を閉じる">×</button><strong>{activeLandmark.name}</strong><span>{activeLandmark.type === 'ic' ? 'IC・出入口' : activeLandmark.type === 'viewpoint' ? '展望・休憩地点' : '周辺地点'} · STARTから約{(activeLandmark.progress * course.distanceKm).toFixed(1)}km</span></aside>}
      </section>}
      <div className="three-d-controls"><label>地形強調 <input type="range" min="1" max="2.5" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /><b>{exaggeration.toFixed(1)}×</b></label><button onClick={resetView}>全体を俯瞰</button></div>
      <div className="three-d-legend"><span><i className="start" />START</span><span><i className="route" />ROUTE</span><span><i className="goal" />GOAL</span><b>高低差 {course.maxElevation - course.minElevation}m</b></div>
    </div>
  )
}
