import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent, type WheelEvent as ReactWheelEvent } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinate, Course } from '../types'
import { supportsWebGL } from '../lib/webgl'
import { fetchElevationProfile, isSuspiciousElevationProfile, type ElevationResult } from '../lib/elevation'
import { toContourFeatureCollection, toCourseAnnotationCollection } from '../lib/mapOverlays'
import { fetchTerrainGrid, type TerrainGrid } from '../lib/terrain'

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
  const value = smoothValue(values[Math.max(0, index - 1)], values[index], values[Math.min(values.length - 1, index + 1)], values[Math.min(values.length - 1, index + 2)], amount)
  return Math.min(Math.max(...values), Math.max(Math.min(...values), value))
}

function normaliseElevationProfile(raw: unknown, minElevation: number, maxElevation: number): number[] {
  const source = Array.isArray(raw) ? raw.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) : []
  const fallback = [Number.isFinite(minElevation) ? minElevation : 0, Number.isFinite(maxElevation) ? maxElevation : 0]
  if (source.length < 2) return fallback
  if (!isSuspiciousElevationProfile(source)) return source
  return source.map((_, index) => {
    const window = source.slice(Math.max(0, index - 4), Math.min(source.length, index + 5)).sort((a, b) => a - b)
    return window[Math.floor(window.length / 2)]
  })
}

type Point3 = [number, number, number]
type Point2 = [number, number]
type ModelView = { yaw: number; pitch: number; zoom: number; pan: Point2 }
type PinchState = { distance: number; zoom: number; pan: Point2; anchor: Point2; modelOffset: Point2 }
type ModelDragState = { pointerId: number; x: number; y: number; yaw: number; pitch: number; anchor: Point2; pivot: Point3 }
type TerrainFace = { points: string; depth: number; fill: string; side?: boolean }

function projectPoint([x, y, z]: Point3, yaw: number, pitch: number, zoom = 1, [panX, panY]: Point2 = [0, 0]): Point2 {
  const yawRad = (yaw * Math.PI) / 180
  const pitchRad = (pitch * Math.PI) / 180
  const rotatedX = x * Math.cos(yawRad) - y * Math.sin(yawRad)
  const depth = x * Math.sin(yawRad) + y * Math.cos(yawRad)
  // Model coordinates use +Y for north. SVG Y grows downward, so the north
  // component is inverted here to keep north at the top in the default view.
  return [500 + panX + rotatedX * zoom, 365 + panY + (-depth * Math.sin(pitchRad) - z * Math.cos(pitchRad)) * zoom]
}

function viewDepth([x, y, z]: Point3, yaw: number, pitch: number): number {
  const yawRad = (yaw * Math.PI) / 180
  const pitchRad = (pitch * Math.PI) / 180
  const horizontalDepth = x * Math.sin(yawRad) + y * Math.cos(yawRad)
  return horizontalDepth * Math.cos(pitchRad) - z * Math.sin(pitchRad)
}

function terrainElevationAt(grid: TerrainGrid | null, [lng, lat]: Coordinate): number | null {
  if (!grid?.rows.length || !grid.rows[0]?.length) return null
  const rows = grid.rows; const rowCount = rows.length - 1; const columnCount = rows[0].length - 1
  if (rowCount < 1 || columnCount < 1) return null
  const minLng = rows[0][0].coordinate[0]; const maxLng = rows[0][columnCount].coordinate[0]
  const minLat = rows[0][0].coordinate[1]; const maxLat = rows[rowCount][0].coordinate[1]
  const columnPosition = Math.max(0, Math.min(columnCount, (lng - minLng) / Math.max(.0000001, maxLng - minLng) * columnCount))
  const rowPosition = Math.max(0, Math.min(rowCount, (lat - minLat) / Math.max(.0000001, maxLat - minLat) * rowCount))
  const column = Math.min(columnCount - 1, Math.floor(columnPosition)); const row = Math.min(rowCount - 1, Math.floor(rowPosition))
  const x = columnPosition - column; const y = rowPosition - row
  const top = rows[row][column].elevation + (rows[row][column + 1].elevation - rows[row][column].elevation) * x
  const bottom = rows[row + 1][column].elevation + (rows[row + 1][column + 1].elevation - rows[row + 1][column].elevation) * x
  return top + (bottom - top) * y
}

function pointsText(points: Point2[]): string { return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }
function wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180 }
function svgPoint(clientX: number, clientY: number, rect: DOMRect): Point2 {
  return [(clientX - rect.left) * 1000 / Math.max(1, rect.width), (clientY - rect.top) * 480 / Math.max(1, rect.height)]
}

function unprojectGroundPoint(screen: Point2, view: ModelView, zoom: number): Point3 {
  const rotatedX = (screen[0] - 500 - view.pan[0]) / zoom
  const pitchSin = Math.sin((view.pitch * Math.PI) / 180)
  const safePitchSin = Math.abs(pitchSin) < .05 ? (pitchSin < 0 ? -.05 : .05) : pitchSin
  const depth = -(screen[1] - 365 - view.pan[1]) / (zoom * safePitchSin)
  const yawRad = (view.yaw * Math.PI) / 180
  return [rotatedX * Math.cos(yawRad) + depth * Math.sin(yawRad), -rotatedX * Math.sin(yawRad) + depth * Math.cos(yawRad), 0]
}
export function Course3DView({ course, onClose, onElevationRepaired }: { course: Course; onClose: () => void; onElevationRepaired?: (course: Course, elevation: number[], source: ElevationResult['source']) => Promise<void> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const progressMarkerRef = useRef<Marker | null>(null)
  const modelDragRef = useRef<ModelDragState | null>(null)
  const modelPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<PinchState | null>(null)
  const touchPinchRef = useRef<PinchState | null>(null)
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
  const [exaggeration, setExaggeration] = useState(1.5)
  const [mapError, setMapError] = useState('')
  const [compactModel, setCompactModel] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [repairedProfile, setRepairedProfile] = useState<number[] | null>(null)
  const [elevationRepairFailed, setElevationRepairFailed] = useState(false)
  const [elevationPersistenceFailed, setElevationPersistenceFailed] = useState(false)
  const [terrainGrid, setTerrainGrid] = useState<TerrainGrid | null>(null)
  const [terrainStatus, setTerrainStatus] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const needsElevationRepair = course.elevationSource === '地形傾向による推定' || isSuspiciousElevationProfile(course.elevationProfile)
  const repairingProfile = needsElevationRepair && repairedProfile === null && !elevationRepairFailed
  const profile = useMemo(() => normaliseElevationProfile(repairedProfile ?? course.elevationProfile, course.minElevation, course.maxElevation), [course.elevationProfile, course.maxElevation, course.minElevation, repairedProfile])
  const profileMin = Math.round(Math.min(...profile))
  const profileMax = Math.round(Math.max(...profile))
  const displayCourse = useMemo(() => ({ ...course, elevationProfile: profile, minElevation: profileMin, maxElevation: profileMax }), [course, profile, profileMax, profileMin])
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
    // Convert metres to the same real-world scene scale as the horizontal axis,
    // then apply one stable exaggeration. The old range-normalisation made an
    // almost-flat route look as tall as a mountain route and changed its shape
    // depending on course length.
    const verticalScale = 3.2 * (exaggeration / 1.5)
    const rawVerticalRange = (elevationRange / 1000) * sceneScale * verticalScale
    const verticalCompression = rawVerticalRange > 220 ? 220 / rawVerticalRange : 1
    const centers: Point3[] = sampled.map(({ point, elevation }) => {
      const terrainElevation = terrainElevationAt(terrainGrid, point)
      // Follow the road profile, but never let its surface sink into the DEM
      // mesh. A tiny clearance also prevents painter-order flicker.
      const visibleElevation = Math.max(elevation, terrainElevation ?? elevation) + 2
      return [
        (point[0] - centerLng) * kmPerLongitude * sceneScale,
        (point[1] - centerLat) * 111.32 * sceneScale,
        ((visibleElevation - elevationMin) / 1000) * sceneScale * verticalScale * verticalCompression,
      ]
    })
    // A narrower ribbon and no segment outline prevent the high-resolution mesh
    // from looking like a chain of oversized dots.
    const width = 5.5
    const left: Point3[] = []; const right: Point3[] = []
    centers.forEach((point, index) => {
      const before = centers[Math.max(0, index - 1)]; const after = centers[Math.min(centers.length - 1, index + 1)]
      const dx = after[0] - before[0]; const dy = after[1] - before[1]; const length = Math.max(1, Math.hypot(dx, dy))
      const offsetX = (-dy / length) * width; const offsetY = (dx / length) * width
      left.push([point[0] + offsetX, point[1] + offsetY, point[2]])
      right.push([point[0] - offsetX, point[1] - offsetY, point[2]])
    })
    // Keep geographic north at the top on first view. Previous versions rotated
    // each route toward a lower-left → upper-right composition, which made the
    // same START → GOAL route appear left/right reversed between courses.
    const defaultYaw = 0
    const defaultProjection = [...left, ...right].map((point) => projectPoint(point, defaultYaw, 49))
    const xExtent = Math.max(...defaultProjection.map(([x]) => x)) - Math.min(...defaultProjection.map(([x]) => x))
    const yExtent = Math.max(...defaultProjection.map(([, y]) => y)) - Math.min(...defaultProjection.map(([, y]) => y))
    // Never enlarge a short route merely to fill the canvas.  The fit only prevents
    // a long / tall route from being clipped, retaining meaningful distance scaling.
    const autoFit = Math.min(1, .96 * Math.min(830 / Math.max(1, xExtent), 310 / Math.max(1, yExtent)))
    return { centers, elevations: sampled.map(({ elevation }) => elevation), autoFit, defaultYaw, sceneScale, centerLng, centerLat, kmPerLongitude, elevationMin, verticalCompression, verticalScale }
  }, [compactModel, course.distanceKm, course.route, exaggeration, profile, terrainGrid])
  const effectiveZoom = model.autoFit * modelZoom

  useEffect(() => {
    setRepairedProfile(null)
    setElevationRepairFailed(false)
    setElevationPersistenceFailed(false)
    if (!needsElevationRepair) return
    let cancelled = false
    fetchElevationProfile(course.route).then((result) => {
      if (cancelled) return
      if (result.source !== '国土地理院 標高API' || result.values.length < 2) { setElevationRepairFailed(true); return }
      setRepairedProfile(result.values)
      if (onElevationRepaired) void onElevationRepaired(course, result.values, result.source).catch(() => { if (!cancelled) setElevationPersistenceFailed(true) })
    })
    return () => { cancelled = true }
  }, [course, needsElevationRepair, onElevationRepaired])

  useEffect(() => {
    applyModelView({ yaw: model.defaultYaw, pitch: 49, zoom: compactModel ? 1.75 : 1.35, pan: [0, 0] }, true)
  }, [compactModel, course.id, model.defaultYaw])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setCompactModel(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setTerrainGrid(null)
    setTerrainStatus('loading')
    // Keep the real DEM mesh deliberately modest: every cell participates in
    // depth sorting while the user drags, so denser grids quickly become costly
    // on mobile without adding much visible detail at this canvas size.
    const resolution = compactModel ? 16 : 24
    fetchTerrainGrid(course.route, resolution, resolution, controller.signal).then((grid) => {
      if (controller.signal.aborted) return
      setTerrainGrid(grid)
      setTerrainStatus('ready')
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      setTerrainStatus('fallback')
    })
    return () => controller.abort()
  }, [compactModel, course.id, course.route])

  useEffect(() => () => { if (modelViewFrameRef.current) window.cancelAnimationFrame(modelViewFrameRef.current) }, [])
  const terrainModel = useMemo(() => {
    const xs = model.centers.map(([x]) => x); const ys = model.centers.map(([, y]) => y)
    const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
    const span = Math.max(180, maxX - minX, maxY - minY)
    let elevations: number[][]
    let terrain: Point3[][]
    if (terrainGrid) {
      elevations = terrainGrid.rows.map((row) => row.map(({ elevation }) => elevation))
      terrain = terrainGrid.rows.map((row) => row.map(({ coordinate: [lng, lat], elevation }) => [
        (lng - model.centerLng) * model.kmPerLongitude * model.sceneScale,
        (lat - model.centerLat) * 111.32 * model.sceneScale,
        ((elevation - model.elevationMin) / 1000) * model.sceneScale * model.verticalScale * model.verticalCompression,
      ]))
    } else {
      const gridSize = compactModel ? 12 : 16
      terrain = []; elevations = []
      for (let row = 0; row <= gridSize; row += 1) {
        terrain[row] = []; elevations[row] = []
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
          elevations[row][column] = model.elevationMin + terrain[row][column][2] / Math.max(.0001, model.sceneScale * model.verticalScale * model.verticalCompression) * 1000
        }
      }
    }
    const rowCount = terrain.length - 1; const columnCount = terrain[0].length - 1
    const terrainMin = Math.min(...elevations.flat()); const terrainMax = Math.max(...elevations.flat()); const terrainRange = Math.max(1, terrainMax - terrainMin)
    const faces: TerrainFace[] = []
    for (let row = 1; row <= rowCount; row += 1) for (let column = 1; column <= columnCount; column += 1) {
      const points = [terrain[row - 1][column - 1], terrain[row - 1][column], terrain[row][column], terrain[row][column - 1]]
      const east = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]]
      const north = [points[3][0] - points[0][0], points[3][1] - points[0][1], points[3][2] - points[0][2]]
      const normal = [east[1] * north[2] - east[2] * north[1], east[2] * north[0] - east[0] * north[2], east[0] * north[1] - east[1] * north[0]]
      const normalLength = Math.max(.001, Math.hypot(...normal)); const lightLength = Math.hypot(-.5, .65, 1)
      const light = Math.max(-.2, Math.min(1, (normal[0] * -.5 + normal[1] * .65 + normal[2]) / (normalLength * lightLength)))
      const averageElevation = elevations.slice(row - 1, row + 1).reduce((sum, values) => sum + values[column - 1] + values[column], 0) / 4
      const elevationAmount = Math.max(0, Math.min(1, (averageElevation - terrainMin) / terrainRange))
      const hue = 151 - elevationAmount * 58; const saturation = 24 - elevationAmount * 7; const luminance = 19 + elevationAmount * 24 + light * 12
      faces.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), fill: `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${luminance.toFixed(0)}%)`, depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw, modelPitch), 0) / points.length })
    }
    // Dark vertical skirts make the terrain read as a physical cut-away model,
    // rather than a transparent sheet floating behind the route.
    const edge = [...terrain[0], ...terrain.slice(1).map((row) => row.at(-1)!), ...terrain.at(-1)!.slice(0, -1).reverse(), ...terrain.slice(1, -1).reverse().map((row) => row[0])]
    const skirtBottom = Math.min(...terrain.flat().map((point) => point[2])) - 24
    edge.forEach((point, index) => {
      const next = edge[(index + 1) % edge.length]
      const points: Point3[] = [point, next, [next[0], next[1], skirtBottom], [point[0], point[1], skirtBottom]]
      faces.push({ points: pointsText(points.map((item) => projectPoint(item, modelYaw, modelPitch, effectiveZoom, modelPan))), fill: '#0b2118', depth: (viewDepth(point, modelYaw, modelPitch) + viewDepth(next, modelYaw, modelPitch)) / 2, side: true })
    })

    const contourStep = terrainRange <= 260 ? 25 : terrainRange <= 650 ? 50 : 100
    const contours: { points: string; depth: number }[] = []
    const firstContour = Math.ceil(terrainMin / contourStep) * contourStep
    for (let level = firstContour; level <= terrainMax; level += contourStep) {
      for (let row = 1; row <= rowCount; row += 1) for (let column = 1; column <= columnCount; column += 1) {
        const cellPoints = [terrain[row - 1][column - 1], terrain[row - 1][column], terrain[row][column], terrain[row][column - 1]]
        const cellElevations = [elevations[row - 1][column - 1], elevations[row - 1][column], elevations[row][column], elevations[row][column - 1]]
        const intersections: Point3[] = []
        for (let edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {
          const nextIndex = (edgeIndex + 1) % 4; const a = cellElevations[edgeIndex]; const b = cellElevations[nextIndex]
          if ((a < level && b < level) || (a > level && b > level) || a === b) continue
          const amount = (level - a) / (b - a); const start = cellPoints[edgeIndex]; const end = cellPoints[nextIndex]
          intersections.push([start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount, start[2] + (end[2] - start[2]) * amount + .8])
        }
        if (intersections.length >= 2) { const points = intersections.slice(0, 2); contours.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw, modelPitch), 0) / points.length }) }
        if (intersections.length === 4) { const points = intersections.slice(2, 4); contours.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw, modelPitch), 0) / points.length }) }
      }
    }
    return { faces, contours, contourStep }
  }, [compactModel, effectiveZoom, model, modelPan, modelPitch, modelYaw, terrainGrid])
  const modelLinePoints = useMemo(() => pointsText(model.centers.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan))), [effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const modelStart = projectPoint(model.centers[0], modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelEnd = projectPoint(model.centers.at(-1)!, modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelCurrent = projectPoint(model.centers[Math.min(model.centers.length - 1, Math.round(progress * (model.centers.length - 1)))], modelYaw, modelPitch, effectiveZoom, modelPan)
  const modelCompass = useMemo(() => {
    const origin = projectPoint([0, 0, 0], modelYaw, modelPitch)
    return ([['N', 0, 1], ['E', 1, 0], ['S', 0, -1], ['W', -1, 0]] as const).map(([label, east, north]) => {
      const projected = projectPoint([east, north, 0], modelYaw, modelPitch)
      const dx = projected[0] - origin[0]; const dy = projected[1] - origin[1]
      const length = Math.max(1, Math.hypot(dx, dy))
      return { label, x: 932 + (dx / length) * 27, y: 57 + (dy / length) * 27, labelX: 932 + (dx / length) * 36, labelY: 57 + (dy / length) * 36 }
    })
  }, [modelPitch, modelYaw])
  const modelLandmarks = useMemo(() => {
    const landmarks = course.landmarks?.length ? course.landmarks : [
      { name: `経由地点 1 · ${(course.distanceKm * .25).toFixed(1)}km`, progress: .25, type: 'place' as const },
      { name: `経由地点 2 · ${(course.distanceKm * .5).toFixed(1)}km`, progress: .5, type: 'place' as const },
      { name: `経由地点 3 · ${(course.distanceKm * .75).toFixed(1)}km`, progress: .75, type: 'place' as const },
    ]
    return landmarks.map((landmark) => {
      const pointIndex = Math.min(model.centers.length - 1, Math.max(0, Math.round(landmark.progress * (model.centers.length - 1))))
      const point = model.centers[pointIndex]
      const [x, y] = projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)
      const labelOnLeft = x > 580
      return { ...landmark, point, x, y, labelX: x + (labelOnLeft ? -12 : 12), labelY: y - 12, labelOnLeft }
    })
  }, [course.distanceKm, course.landmarks, effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const visibleLandmarks = useMemo(() => {
    const limit = effectiveZoom < .9 ? 2 : effectiveZoom < 1.35 ? 3 : modelLandmarks.length
    return modelLandmarks.filter((_, index) => index < limit)
  }, [effectiveZoom, modelLandmarks])
  const distanceMarkers = useMemo(() => {
    const markers: { distance: number; x: number; y: number; point: Point3; depth: number }[] = []
    for (let distance = 5; distance < course.distanceKm; distance += 5) {
      const point = model.centers[Math.round((distance / course.distanceKm) * (model.centers.length - 1))]
      const [x, y] = projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)
      markers.push({ distance, x, y, point, depth: viewDepth(point, modelYaw, modelPitch) - 9 })
    }
    return markers
  }, [course.distanceKm, effectiveZoom, model.centers, modelPan, modelPitch, modelYaw])
  const gradeSegments = useMemo(() => model.centers.slice(1).map((point, index) => {
    const before = model.centers[index]
    const horizontalMetres = (Math.hypot(point[0] - before[0], point[1] - before[1]) / model.sceneScale) * 1000
    const gradientPercent = horizontalMetres > .1 ? ((model.elevations[index + 1] - model.elevations[index]) / horizontalMetres) * 100 : 0
    const color = gradientPercent > 4 ? '#e86a4d' : gradientPercent < -4 ? '#54a8f7' : '#54bd86'
    return { points: pointsText([projectPoint(before, modelYaw, modelPitch, effectiveZoom, modelPan), projectPoint(point, modelYaw, modelPitch, effectiveZoom, modelPan)]), color, depth: (viewDepth(before, modelYaw, modelPitch) + viewDepth(point, modelYaw, modelPitch)) / 2 - 7 }
  }), [effectiveZoom, model.centers, model.elevations, model.sceneScale, modelPan, modelPitch, modelYaw])
  const geometryLayers = useMemo(() => [
    ...terrainModel.faces.map((face, index) => ({ kind: 'terrain' as const, key: `terrain-${index}`, ...face })),
    ...terrainModel.contours.map((contour, index) => ({ kind: 'contour' as const, key: `contour-${index}`, ...contour })),
    ...gradeSegments.map((segment, index) => ({ kind: 'route' as const, key: `route-${index}`, ...segment })),
  ], [gradeSegments, terrainModel.contours, terrainModel.faces])
  const highlights = useMemo(() => {
    const entries = [
      { key: 'gradient', label: '急勾配', color: '#e86a4d', progress: 0 },
      { key: 'curves', label: '連続カーブ', color: '#f2d16b', progress: 0 },
      { key: 'view', label: '展望区間', color: '#78c4ff', progress: .72 },
    ]
    let steepest = 0; let steepIndex = 0; let curveScore = 0; let curveIndex = 0
    for (let index = 1; index < model.centers.length - 1; index += 1) {
      const a = model.centers[index - 1]; const b = model.centers[index]; const c = model.centers[index + 1]
      const horizontalMetres = (Math.hypot(c[0] - a[0], c[1] - a[1]) / model.sceneScale) * 1000
      const steep = horizontalMetres > .1 ? Math.abs((model.elevations[index + 1] - model.elevations[index - 1]) / horizontalMetres) : 0
      if (steep > steepest) { steepest = steep; steepIndex = index }
      const vx = b[0] - a[0]; const vy = b[1] - a[1]; const wx = c[0] - b[0]; const wy = c[1] - b[1]
      const bend = Math.abs(vx * wy - vy * wx); if (bend > curveScore) { curveScore = bend; curveIndex = index }
    }
    entries[0].progress = steepIndex / Math.max(1, model.centers.length - 1)
    entries[1].progress = curveIndex / Math.max(1, model.centers.length - 1)
    return entries.map((entry) => ({ ...entry, point: model.centers[Math.round(entry.progress * (model.centers.length - 1))] }))
  }, [model.centers, model.elevations, model.sceneScale])
  const depthLayers = useMemo(() => [
    ...geometryLayers,
    ...distanceMarkers.map((marker) => ({ kind: 'distance' as const, key: `distance-${marker.distance}`, ...marker })),
    ...highlights.map((item) => { const [x, y] = projectPoint(item.point, modelYaw, modelPitch, effectiveZoom, modelPan); return { kind: 'highlight' as const, ...item, x, y, depth: viewDepth(item.point, modelYaw, modelPitch) - 9 } }),
    ...visibleLandmarks.map((landmark) => ({ kind: 'landmark' as const, key: `landmark-${landmark.name}-${landmark.progress}`, ...landmark, depth: viewDepth(landmark.point, modelYaw, modelPitch) - 9 })),
    { kind: 'terminal' as const, key: 'terminal-start', terminal: 'start' as const, x: modelStart[0], y: modelStart[1], elevation: profile[0], depth: viewDepth(model.centers[0], modelYaw, modelPitch) - 9 },
    { kind: 'terminal' as const, key: 'terminal-goal', terminal: 'goal' as const, x: modelEnd[0], y: modelEnd[1], elevation: profile.at(-1) ?? 0, depth: viewDepth(model.centers.at(-1)!, modelYaw, modelPitch) - 9 },
  ].sort((a, b) => b.depth - a.depth), [distanceMarkers, effectiveZoom, geometryLayers, highlights, model.centers, modelEnd, modelPan, modelPitch, modelStart, modelYaw, profile, visibleLandmarks])

  useEffect(() => {
    if (!containerRef.current) return
    if (!supportsWebGL()) { setMapError('この端末ではWebGL地形を利用できません。'); return }
    let map: MapLibreMap
    try {
      map = new maplibregl.Map({ container: containerRef.current, style: 'https://tiles.openfreemap.org/styles/liberty', center: course.route[Math.floor(course.route.length / 2)], zoom: 11, pitch: 70, bearing: -28, maxPitch: 85, attributionControl: false })
    } catch { setMapError('3D地図を初期化できませんでした。'); return }
    map.on('error', (event) => {
      const message = event.error?.message ?? ''
      if (/Expected value to be of type number, but found null|terrain|DEM|tile/i.test(message)) return
      console.warn('3D地図データの一部を読み込めませんでした', message)
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.FullscreenControl(), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => {
      map.addSource('terrain-dem', { type: 'raster-dem', url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json', tileSize: 256, encoding: 'terrarium' })
      // MapLibre recommends separate raster-dem source instances for terrain
      // displacement and hillshade rendering, even when they share tile URLs.
      map.addSource('hillshade-dem', { type: 'raster-dem', url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json', tileSize: 256, encoding: 'terrarium' })
      map.addLayer({ id: 'terrain-hillshade', type: 'hillshade', source: 'hillshade-dem', paint: { 'hillshade-exaggeration': .34, 'hillshade-shadow-color': '#42574d', 'hillshade-highlight-color': '#f6f1dd', 'hillshade-accent-color': '#718477' } })
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 })
      map.addSource('course-contours', { type: 'geojson', data: toContourFeatureCollection(displayCourse) })
      map.addLayer({ id: 'course-contours', type: 'line', source: 'course-contours', paint: { 'line-color': '#637e70', 'line-width': 1.2, 'line-opacity': .62, 'line-dasharray': [1, 2] } })
      map.addLayer({ id: 'course-contour-labels', type: 'symbol', source: 'course-contours', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#3d5b4c', 'text-halo-color': '#f6f1dd', 'text-halo-width': 1.5 } })
      map.addSource('course-annotations', { type: 'geojson', data: toCourseAnnotationCollection(displayCourse) })
      map.addLayer({ id: 'course-annotation-points', type: 'circle', source: 'course-annotations', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'gradient', '#df624a', 'curves', '#d69f35', 'viewpoint', '#4c9ed9', '#4c9b79'], 'circle-stroke-color': '#f6f1dd', 'circle-stroke-width': 2 } })
      map.addLayer({ id: 'course-annotation-labels', type: 'symbol', source: 'course-annotations', layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd', 'text-halo-width': 2 } })
      map.addSource('selected-course', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: course.route } } })
      map.addLayer({ id: 'route-glow', type: 'line', source: 'selected-course', paint: { 'line-color': '#101915', 'line-width': 11, 'line-opacity': .55 } })
      map.addLayer({ id: 'route-main', type: 'line', source: 'selected-course', paint: { 'line-color': '#f2d16b', 'line-width': 6 } })
      // Keep every route annotation above the route stroke, even when the
      // route is zoomed or rendered with a wide glow.
      map.moveLayer('course-contour-labels')
      map.moveLayer('course-annotation-points')
      map.moveLayer('course-annotation-labels')
      new maplibregl.Marker({ color: '#2d795a' }).setLngLat(course.route[0]).setPopup(new maplibregl.Popup().setText('START')).addTo(map)
      new maplibregl.Marker({ color: '#d3523c' }).setLngLat(course.route.at(-1)!).setPopup(new maplibregl.Popup().setText('GOAL')).addTo(map)
      progressMarkerRef.current = new maplibregl.Marker({ color: '#fff', scale: .8 }).setLngLat(course.route[0]).addTo(map)
      const bounds = course.route.reduce((value, point) => value.extend(point), new maplibregl.LngLatBounds(course.route[0], course.route[0]))
      map.fitBounds(bounds, { padding: 90, pitch: 70, bearing: -28, maxZoom: 13, duration: 1200 })
    })
    mapRef.current = map
    return () => { progressMarkerRef.current?.remove(); progressMarkerRef.current = null; map.remove() }
  }, [course, displayCourse])

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

  function beginPinch(first: { x: number; y: number }, second: { x: number; y: number }, rect: DOMRect): PinchState {
    const anchor = svgPoint((first.x + second.x) / 2, (first.y + second.y) / 2, rect)
    const view = modelViewRef.current
    // Store the model-space vector beneath the two fingers. At each zoom level
    // we solve pan from that same vector, so content does not snap to canvas centre.
    return {
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), zoom: view.zoom, pan: view.pan, anchor,
      modelOffset: [(anchor[0] - 500 - view.pan[0]) / effectiveZoom, (anchor[1] - 365 - view.pan[1]) / effectiveZoom],
    }
  }

  function applyPinch(pinch: PinchState, first: { x: number; y: number }, second: { x: number; y: number }, rect: DOMRect) {
    const zoom = pinch.zoom * (Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)) / pinch.distance)
    const anchor = svgPoint((first.x + second.x) / 2, (first.y + second.y) / 2, rect)
    // Two-finger panning felt too restrained on phones because the SVG viewBox
    // dampens physical finger travel. Amplify midpoint translation while keeping
    // the original model point anchored during pinch zoom.
    const horizontalPanGain = 1.65
    const verticalPanGain = 2.5
    const targetAnchor: Point2 = [
      pinch.anchor[0] + (anchor[0] - pinch.anchor[0]) * horizontalPanGain,
      pinch.anchor[1] + (anchor[1] - pinch.anchor[1]) * verticalPanGain,
    ]
    const visualZoom = model.autoFit * zoom
    applyModelView({ zoom, pan: [targetAnchor[0] - 500 - pinch.modelOffset[0] * visualZoom, targetAnchor[1] - 365 - pinch.modelOffset[1] * visualZoom] })
  }

  function startModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic pointer events may not be capturable. */ }
    modelPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (modelPointersRef.current.size === 1) {
      // One finger changes the viewing angle: horizontal swipes orbit and
      // vertical swipes alter the pitch.
      const view = modelViewRef.current
      const anchor = svgPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
      modelDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch, anchor, pivot: unprojectGroundPoint(anchor, view, effectiveZoom) }
      pinchRef.current = null
      return
    }
    if (modelPointersRef.current.size === 2) {
      const [first, second] = [...modelPointersRef.current.values()]
      const rect = event.currentTarget.getBoundingClientRect()
      pinchRef.current = beginPinch(first, second, rect)
      modelDragRef.current = null
    }
  }

  function moveModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!modelPointersRef.current.has(event.pointerId)) return
    modelPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (modelPointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...modelPointersRef.current.values()]
      applyPinch(pinchRef.current, first, second, event.currentTarget.getBoundingClientRect())
      return
    }
    const drag = modelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // Keep the established vertical gesture. Horizontal orbit follows the
    // driver's swipe direction so left/right movement is not mirrored.
    const yaw = drag.yaw + (event.clientX - drag.x) * .35
    const pitch = drag.pitch + (event.clientY - drag.y) * .35
    const projectedPivot = projectPoint(drag.pivot, yaw, pitch, effectiveZoom)
    applyModelView({ yaw, pitch, pan: [drag.anchor[0] - projectedPivot[0], drag.anchor[1] - projectedPivot[1]] })
  }

  function endModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    modelPointersRef.current.delete(event.pointerId)
    if (modelPointersRef.current.size < 2) pinchRef.current = null
    if (modelDragRef.current?.pointerId === event.pointerId) modelDragRef.current = null
    // Resume one-finger viewpoint control when a finger remains after a pinch.
    if (modelPointersRef.current.size === 1) {
      const [pointerId, pointer] = [...modelPointersRef.current.entries()][0]
      const view = modelViewRef.current
      const anchor = svgPoint(pointer.x, pointer.y, event.currentTarget.getBoundingClientRect())
      modelDragRef.current = { pointerId, x: pointer.x, y: pointer.y, yaw: view.yaw, pitch: view.pitch, anchor, pivot: unprojectGroundPoint(anchor, view, effectiveZoom) }
    }
  }

  // Some installed-web-app WebViews do not reliably forward a second PointerEvent
  // to SVG. Keep a native touch fallback so pinch remains available there too.
  function startModelTouch(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length !== 2) return
    // Pointer events are the primary path. This fallback is only for installed
    // WebViews which fail to deliver a second pointer to the SVG.
    if (modelPointersRef.current.size) return
    const first = { x: event.touches[0].clientX, y: event.touches[0].clientY }; const second = { x: event.touches[1].clientX, y: event.touches[1].clientY }
    const rect = event.currentTarget.getBoundingClientRect()
    touchPinchRef.current = beginPinch(first, second, rect)
  }

  function moveModelTouch(event: ReactTouchEvent<SVGSVGElement>) {
    if (event.touches.length !== 2 || !touchPinchRef.current || modelPointersRef.current.size) return
    const first = { x: event.touches[0].clientX, y: event.touches[0].clientY }; const second = { x: event.touches[1].clientX, y: event.touches[1].clientY }
    applyPinch(touchPinchRef.current, first, second, event.currentTarget.getBoundingClientRect())
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
      {mode === 'model' && <section className={`route-model-panel ${repairingProfile ? 'profile-repairing' : ''}`} aria-label="3Dルート模型" aria-busy={repairingProfile}>
        <div className="model-tools"><div className="model-preset-buttons"><button onClick={() => applyModelView({ yaw: model.defaultYaw, pitch: 49, zoom: compactModel ? 1.75 : 1.35, pan: [0, 0] })}>全体</button><button onClick={() => applyModelView({ yaw: model.defaultYaw, pitch: 8, zoom: compactModel ? 1.9 : 1.5, pan: [0, 0] })}>横から</button><button onClick={() => applyModelView({ yaw: model.defaultYaw + 35, pitch: 62, zoom: compactModel ? 1.8 : 1.4, pan: [0, 0] })}>進行方向</button><button onClick={() => applyModelView({ yaw: model.defaultYaw - 55, pitch: 72, zoom: compactModel ? 1.85 : 1.45, pan: [0, 0] })}>カーブ</button></div></div>
        {repairingProfile && <div className="model-profile-loading" role="status"><span aria-hidden="true" /><strong>標高データを再計算中</strong><small>このコースの古い異常波形を修復しています</small></div>}
        {terrainStatus === 'loading' && <div className="model-terrain-status" role="status"><span aria-hidden="true" />周辺地形を読み込み中</div>}
        {terrainStatus === 'fallback' && <div className="model-terrain-status fallback" role="status">地形データを取得できないため簡易地形を表示中</div>}
        {elevationRepairFailed && <p className="model-profile-warning" role="status">標高データを確認できませんでした。誤った推定値は保存していません。通信後にもう一度開いてください。</p>}
        {elevationPersistenceFailed && <p className="model-profile-warning" role="status">表示は修復しましたが、Firestoreへの保存に失敗しました。ログイン状態と通信を確認して、もう一度開いてください。</p>}
        <svg className="route-model-canvas" viewBox="0 0 1000 480" role="img" aria-label={`${course.name}の3Dルート模型。1本指で視点を回転、2本指で平行移動とピンチ拡大縮小ができます。`} onPointerDown={startModelDrag} onPointerMove={moveModelDrag} onPointerUp={endModelDrag} onPointerCancel={endModelDrag} onTouchStart={startModelTouch} onTouchMove={moveModelTouch} onTouchEnd={endModelTouch} onTouchCancel={endModelTouch} onWheel={zoomModel}>
          <defs><linearGradient id="model-route-line" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#45ba7d" /><stop offset=".52" stopColor="#f2d16b" /><stop offset="1" stopColor="#df624a" /></linearGradient></defs>
          <g className="model-depth-scene" aria-label={`${terrainModel.contourStep}m間隔の等高線`}>
            {depthLayers.map((layer) => {
              if (layer.kind === 'terrain') return <polygon className={`model-terrain-surface ${layer.side ? 'terrain-skirt' : ''}`} key={layer.key} points={layer.points} fill={layer.fill} />
              if (layer.kind === 'contour') return <polyline className="model-terrain-contour" key={layer.key} points={layer.points} />
              if (layer.kind === 'route') return <polyline className="model-grade-segment" key={layer.key} points={layer.points} stroke={layer.color} />
              if (layer.kind === 'distance') return <g className="distance-marker" key={layer.key}><circle cx={layer.x} cy={layer.y} r="4" /><text x={layer.x + 8} y={layer.y - 8}>{layer.distance}km</text></g>
              if (layer.kind === 'highlight') return <g className="route-highlight" key={layer.key}><circle cx={layer.x} cy={layer.y} r="9" stroke={layer.color} /><text x={layer.x + 12} y={layer.y + 5}>{layer.label}</text></g>
              if (layer.kind === 'landmark') return <g className={`model-landmark ${layer.type ?? 'place'}`} key={layer.key} role="button" tabIndex={0} aria-label={`${layer.name}の地点情報を開く`} onPointerDown={(event) => { event.stopPropagation(); setActiveLandmark(layer) }} onClick={(event) => { event.stopPropagation(); setActiveLandmark(layer) }}><circle cx={layer.x} cy={layer.y} r="7" /><line x1={layer.x} y1={layer.y} x2={layer.labelX} y2={layer.labelY + 3} /><text x={layer.labelX} y={layer.labelY} textAnchor={layer.labelOnLeft ? 'end' : 'start'}>{layer.name}</text></g>
              return layer.terminal === 'start'
                ? <g className="model-terminal start" key={layer.key}><circle cx={layer.x} cy={layer.y} r="10" /><text x={layer.x - 32} y={layer.y + 38}>START</text><text x={layer.x - 42} y={layer.y + 59}>{layer.elevation}m</text></g>
                : <g className="model-terminal goal" key={layer.key}><circle cx={layer.x} cy={layer.y} r="10" /><text x={layer.x - 26} y={layer.y - 27}>GOAL</text><text x={layer.x - 31} y={layer.y - 7}>{layer.elevation}m</text></g>
            })}
          </g>
          <circle className="route-travel-dot" r="7" fill="#fff"><animateMotion dur="6s" repeatCount="indefinite" path={`M ${modelLinePoints.replaceAll(' ', ' L ')}`} /></circle>
          <g className="model-compass" aria-label="方位"><circle cx="932" cy="57" r="33" />{modelCompass.map((direction) => <g key={direction.label} className={direction.label === 'N' ? 'north' : ''}><line x1="932" y1="57" x2={direction.x} y2={direction.y} /><text x={direction.labelX} y={direction.labelY}>{direction.label}</text></g>)}</g>
          <circle className="model-current" cx={modelCurrent[0]} cy={modelCurrent[1]} r="6" fill="#fff" stroke="#101915" strokeWidth="2" /><text x="410" y="455">距離 {course.distanceKm}km</text>
        </svg>
        <small className="model-terrain-credit">地形: {terrainStatus === 'ready' ? 'AWS Terrain Tiles（実標高）' : '簡易推定'} · 等高線 {terrainModel.contourStep}m</small>
        {activeLandmark && <aside className="landmark-card"><button onClick={() => setActiveLandmark(null)} aria-label="地点情報を閉じる">×</button><strong>{activeLandmark.name}</strong><span>{activeLandmark.type === 'ic' ? 'IC・出入口' : activeLandmark.type === 'viewpoint' ? '展望・休憩地点' : '周辺地点'} · STARTから約{(activeLandmark.progress * course.distanceKm).toFixed(1)}km</span></aside>}
      </section>}
      <div className="three-d-controls"><label>地形強調 <input type="range" min="1" max="2.5" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /><b>{exaggeration.toFixed(1)}×</b></label><button onClick={resetView}>全体を俯瞰</button></div>
      <div className="three-d-legend"><span><i className="start" />START</span><span><i className="route" />ROUTE</span><span><i className="goal" />GOAL</span><b>高低差 {profileMax - profileMin}m</b></div>
    </div>
  )
}
