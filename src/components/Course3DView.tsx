import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinate, Course } from '../types'
import { supportsWebGL } from '../lib/webgl'

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

function projectPoint([x, y, z]: Point3, yaw: number, pitch: number, zoom = 1): Point2 {
  const yawRad = (yaw * Math.PI) / 180
  const pitchRad = (pitch * Math.PI) / 180
  const rotatedX = x * Math.cos(yawRad) - y * Math.sin(yawRad)
  const depth = x * Math.sin(yawRad) + y * Math.cos(yawRad)
  return [500 + rotatedX * zoom, 365 + (depth * Math.sin(pitchRad) - z * Math.cos(pitchRad)) * zoom]
}

function viewDepth([x, y]: Point3, yaw: number): number {
  const yawRad = (yaw * Math.PI) / 180
  return x * Math.sin(yawRad) + y * Math.cos(yawRad)
}

function pointsText(points: Point2[]): string { return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') }
function wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180 }

export function Course3DView({ course, onClose }: { course: Course; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const progressMarkerRef = useRef<Marker | null>(null)
  const modelDragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null)
  const [mode, setMode] = useState<ViewMode>('overview')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [modelYaw, setModelYaw] = useState(0)
  const [modelPitch, setModelPitch] = useState(49)
  const [modelZoom, setModelZoom] = useState(1)
  const [exaggeration, setExaggeration] = useState(1.5)
  const [mapError, setMapError] = useState('')
  const profile = useMemo(() => course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation], [course.elevationProfile, course.maxElevation, course.minElevation])
  const currentElevation = elevationAt(profile, progress)
  const currentPoint = pointAt(course.route, progress)
  const model = useMemo(() => {
    // Keep each ribbon segment short even on long courses.  This makes the
    // individual joints substantially smaller while retaining a smooth route.
    const sampleCount = Math.min(560, Math.max(220, course.route.length * 2))
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
    const width = 8; const thickness = 15
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
  }, [course.distanceKm, course.route, profile])
  const effectiveZoom = model.autoFit * modelZoom

  useEffect(() => {
    setModelYaw(model.defaultYaw)
    setModelPitch(49)
    setModelZoom(1)
  }, [course.id, model.defaultYaw])
  const modelFaces = useMemo(() => {
    const faces: { points: string; color: string; depth: number }[] = []
    const addFace = (points: Point3[], color: string) => {
      faces.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom))), color, depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw), 0) / points.length })
    }
    model.left.slice(1).forEach((_, index) => {
      const i = index + 1
      const leftBefore = model.left[i - 1]; const leftNow = model.left[i]
      const rightBefore = model.right[i - 1]; const rightNow = model.right[i]
      const leftUnder: Point3 = [leftNow[0], leftNow[1], leftNow[2] - model.thickness]
      const leftBeforeUnder: Point3 = [leftBefore[0], leftBefore[1], leftBefore[2] - model.thickness]
      const rightUnder: Point3 = [rightNow[0], rightNow[1], rightNow[2] - model.thickness]
      const rightBeforeUnder: Point3 = [rightBefore[0], rightBefore[1], rightBefore[2] - model.thickness]
      const hue = 148 - (i / Math.max(1, model.left.length - 1)) * 138
      addFace([leftBefore, rightBefore, rightNow, leftNow], `hsl(${hue} 66% 60%)`)
      addFace([rightBefore, rightNow, rightUnder, rightBeforeUnder], '#07100c')
      addFace([leftNow, leftBefore, leftBeforeUnder, leftUnder], '#10261b')
      addFace([leftBeforeUnder, rightBeforeUnder, rightUnder, leftUnder], '#050a07')
    })
    const startLeft = model.left[0]; const startRight = model.right[0]; const endLeft = model.left.at(-1)!; const endRight = model.right.at(-1)!
    addFace([startLeft, startRight, [startRight[0], startRight[1], startRight[2] - model.thickness], [startLeft[0], startLeft[1], startLeft[2] - model.thickness]], '#122d20')
    addFace([endRight, endLeft, [endLeft[0], endLeft[1], endLeft[2] - model.thickness], [endRight[0], endRight[1], endRight[2] - model.thickness]], '#122d20')
    return faces.sort((a, b) => a.depth - b.depth)
  }, [effectiveZoom, model, modelPitch, modelYaw])
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
      faces.push({ points: pointsText(points.map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom))), depth: points.reduce((sum, point) => sum + viewDepth(point, modelYaw), 0) / points.length })
    }
    return faces.sort((a, b) => a.depth - b.depth)
  }, [effectiveZoom, model.centers, modelPitch, modelYaw])
  const modelStart = projectPoint(model.centers[0], modelYaw, modelPitch, effectiveZoom)
  const modelEnd = projectPoint(model.centers.at(-1)!, modelYaw, modelPitch, effectiveZoom)
  const modelCurrent = projectPoint(model.centers[Math.min(model.centers.length - 1, Math.round(progress * (model.centers.length - 1)))], modelYaw, modelPitch, effectiveZoom)
  const modelLandmarks = useMemo(() => {
    const landmarks = course.landmarks?.length ? course.landmarks : [
      { name: `約${(course.distanceKm * .25).toFixed(1)}km`, progress: .25, type: 'place' as const },
      { name: `約${(course.distanceKm * .5).toFixed(1)}km`, progress: .5, type: 'place' as const },
      { name: `約${(course.distanceKm * .75).toFixed(1)}km`, progress: .75, type: 'place' as const },
    ]
    return landmarks.map((landmark) => {
      const pointIndex = Math.min(model.centers.length - 1, Math.max(0, Math.round(landmark.progress * (model.centers.length - 1))))
      const point = model.centers[pointIndex]
      const [x, y] = projectPoint(point, modelYaw, modelPitch, effectiveZoom)
      const labelOnLeft = x > 580
      return { ...landmark, x, y, labelX: x + (labelOnLeft ? -12 : 12), labelY: y - 12, labelOnLeft }
    })
  }, [course.distanceKm, course.landmarks, effectiveZoom, model.centers, modelPitch, modelYaw])

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
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 })
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

  function startModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    modelDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, yaw: modelYaw, pitch: modelPitch }
  }

  function moveModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = modelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    // Dragging moves the model in the same apparent direction as the pointer.
    setModelYaw(wrapDegrees(drag.yaw - (event.clientX - drag.x) * .45))
    setModelPitch(Math.min(89, Math.max(-89, drag.pitch + (event.clientY - drag.y) * .35)))
  }

  function endModelDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (modelDragRef.current?.pointerId === event.pointerId) modelDragRef.current = null
  }

  function zoomModel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault()
    setModelZoom((value) => Math.min(2.1, Math.max(.55, value * (event.deltaY > 0 ? .9 : 1.1))))
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
      {mode === 'model' && <section className="route-model-panel" aria-label="3Dルート模型"><div className="model-title"><strong>実ルートの立体リボン</strong><span>距離基準の自動縮尺 {Math.round(model.autoFit * 100)}% · START → GOAL · 上下左右360°ドラッグ · スクロールで縮尺変更（{Math.round(effectiveZoom * 100)}%）</span><button onClick={() => { setModelYaw(model.defaultYaw); setModelPitch(49); setModelZoom(1) }}>視点を戻す</button></div><svg className="route-model-canvas" viewBox="0 0 1000 480" role="img" aria-label={`${course.name}の3Dルート模型。実距離に基づき自動縮尺され、開始地点からゴール地点の方向で表示されます。上下左右360度ドラッグで視点変更、スクロールで縮尺変更`} onPointerDown={startModelDrag} onPointerMove={moveModelDrag} onPointerUp={endModelDrag} onPointerCancel={endModelDrag} onWheel={zoomModel}><defs><linearGradient id="terrain-wash" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#86c7a4" stopOpacity=".32" /><stop offset="1" stopColor="#183f2d" stopOpacity=".1" /></linearGradient></defs><g className="model-terrain">{terrainFaces.map((face, index) => <polygon key={index} points={face.points} fill="url(#terrain-wash)" />)}</g><g className="model-ribbon">{modelFaces.map((face, index) => <polygon key={index} points={face.points} fill={face.color} />)}</g>{modelLandmarks.map((landmark) => <g className={`model-landmark ${landmark.type ?? 'place'}`} key={`${landmark.name}-${landmark.progress}`}><circle cx={landmark.x} cy={landmark.y} r="4" /><line x1={landmark.x} y1={landmark.y} x2={landmark.labelX} y2={landmark.labelY + 3} /><text x={landmark.labelX} y={landmark.labelY} textAnchor={landmark.labelOnLeft ? 'end' : 'start'}>{landmark.name}</text></g>)}<circle className="model-current" cx={modelCurrent[0]} cy={modelCurrent[1]} r="7" fill="#fff" stroke="#101915" strokeWidth="3" /><text x={modelStart[0] - 32} y={modelStart[1] + 38}>START</text><text x={modelStart[0] - 42} y={modelStart[1] + 59}>{profile[0]}m</text><text x={modelEnd[0] - 26} y={modelEnd[1] - 27}>GOAL</text><text x={modelEnd[0] - 31} y={modelEnd[1] - 7}>{profile.at(-1)}m</text><text x="410" y="455">距離 {course.distanceKm}km</text></svg></section>}
      <div className="three-d-controls"><label>地形強調 <input type="range" min="1" max="2.5" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /><b>{exaggeration.toFixed(1)}×</b></label><button onClick={resetView}>全体を俯瞰</button></div>
      <div className="three-d-legend"><span><i className="start" />START</span><span><i className="route" />ROUTE</span><span><i className="goal" />GOAL</span><b>高低差 {course.maxElevation - course.minElevation}m</b></div>
    </div>
  )
}
