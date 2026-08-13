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
    const sampleCount = Math.min(260, Math.max(96, course.route.length))
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
    const width = 13; const thickness = 18
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
  const modelPolygons = useMemo(() => model.left.slice(1).map((_, index) => {
    const i = index + 1
    const top = [model.left[i - 1], model.right[i - 1], model.right[i], model.left[i]].map((point) => projectPoint(point, modelYaw, modelPitch, effectiveZoom))
    const side = [model.right[i - 1], model.right[i], [model.right[i][0], model.right[i][1], model.right[i][2] - model.thickness], [model.right[i - 1][0], model.right[i - 1][1], model.right[i - 1][2] - model.thickness]].map((point) => projectPoint(point as Point3, modelYaw, modelPitch, effectiveZoom))
    return { top: pointsText(top), side: pointsText(side), color: `hsl(${148 - (i / Math.max(1, model.left.length - 1)) * 138} 66% 60%)` }
  }), [effectiveZoom, model, modelPitch, modelYaw])
  const modelStart = projectPoint(model.centers[0], modelYaw, modelPitch, effectiveZoom)
  const modelEnd = projectPoint(model.centers.at(-1)!, modelYaw, modelPitch, effectiveZoom)
  const modelCurrent = projectPoint(model.centers[Math.min(model.centers.length - 1, Math.round(progress * (model.centers.length - 1)))], modelYaw, modelPitch, effectiveZoom)

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
    setModelPitch(Math.min(89, Math.max(-89, drag.pitch - (event.clientY - drag.y) * .35)))
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
      {mode === 'model' && <section className="route-model-panel" aria-label="3Dルート模型"><div className="model-title"><strong>実ルートの立体リボン</strong><span>距離基準の自動縮尺 {Math.round(model.autoFit * 100)}% · START → GOAL · 上下左右360°ドラッグ · スクロールで縮尺変更（{Math.round(effectiveZoom * 100)}%）</span><button onClick={() => { setModelYaw(model.defaultYaw); setModelPitch(49); setModelZoom(1) }}>視点を戻す</button></div><svg className="route-model-canvas" viewBox="0 0 1000 480" role="img" aria-label={`${course.name}の3Dルート模型。実距離に基づき自動縮尺され、開始地点からゴール地点の方向で表示されます。上下左右360度ドラッグで視点変更、スクロールで縮尺変更`} onPointerDown={startModelDrag} onPointerMove={moveModelDrag} onPointerUp={endModelDrag} onPointerCancel={endModelDrag} onWheel={zoomModel}><defs><linearGradient id="model-floor" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#1b4436" stopOpacity=".7" /><stop offset="1" stopColor="#06100c" stopOpacity=".1" /></linearGradient></defs><polygon points={pointsText([projectPoint([-330, -230, 0], modelYaw, modelPitch, effectiveZoom), projectPoint([330, -230, 0], modelYaw, modelPitch, effectiveZoom), projectPoint([330, 230, 0], modelYaw, modelPitch, effectiveZoom), projectPoint([-330, 230, 0], modelYaw, modelPitch, effectiveZoom)])} fill="url(#model-floor)" stroke="#ffffff24" />{modelPolygons.map((polygon, index) => <g key={index}><polygon points={polygon.side} fill="#07100ccc" /><polygon points={polygon.top} fill={polygon.color} stroke="#fff4" strokeWidth="1" /></g>)}<circle cx={modelCurrent[0]} cy={modelCurrent[1]} r="11" fill="#fff" stroke="#101915" strokeWidth="5" /><text x={modelStart[0] - 32} y={modelStart[1] + 38}>START</text><text x={modelStart[0] - 42} y={modelStart[1] + 59}>{profile[0]}m</text><text x={modelEnd[0] - 26} y={modelEnd[1] - 27}>GOAL</text><text x={modelEnd[0] - 31} y={modelEnd[1] - 7}>{profile.at(-1)}m</text><text x="410" y="455">距離 {course.distanceKm}km</text></svg></section>}
      <div className="three-d-controls"><label>地形強調 <input type="range" min="1" max="2.5" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /><b>{exaggeration.toFixed(1)}×</b></label><button onClick={resetView}>全体を俯瞰</button></div>
      <div className="three-d-legend"><span><i className="start" />START</span><span><i className="route" />ROUTE</span><span><i className="goal" />GOAL</span><b>高低差 {course.maxElevation - course.minElevation}m</b></div>
    </div>
  )
}
