import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinate, Course } from '../types'
import { supportsWebGL } from '../lib/webgl'

type ViewMode = 'overview' | 'preview' | 'elevation' | 'model'

function pointAt(route: Coordinate[], progress: number): Coordinate {
  const index = Math.min(route.length - 1, Math.max(0, Math.round(progress * (route.length - 1))))
  return route[index]
}

function elevationAt(values: number[], progress: number): number {
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.max(0, Math.round(progress * (values.length - 1))))]
}

function profilePoints(values: number[], width: number, height: number, padding = 24): string {
  const min = Math.min(...values); const max = Math.max(...values); const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2)
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export function Course3DView({ course, onClose }: { course: Course; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const progressMarkerRef = useRef<Marker | null>(null)
  const [mode, setMode] = useState<ViewMode>('overview')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exaggeration, setExaggeration] = useState(1.5)
  const [mapError, setMapError] = useState('')
  const profile = useMemo(() => course.elevationProfile.length > 1 ? course.elevationProfile : [course.minElevation, course.maxElevation], [course.elevationProfile, course.maxElevation, course.minElevation])
  const currentElevation = elevationAt(profile, progress)
  const currentPoint = pointAt(course.route, progress)
  const profileLine = useMemo(() => profilePoints(profile, 900, 260), [profile])
  const modelPoints = useMemo(() => {
    const lats = course.route.map(([, lat]) => lat)
    const latMin = Math.min(...lats); const latRange = Math.max(0.0001, Math.max(...lats) - latMin)
    const min = Math.min(...profile); const range = Math.max(1, Math.max(...profile) - min)
    return profile.map((value, index) => {
      const routePoint = pointAt(course.route, index / Math.max(1, profile.length - 1))
      const x = 70 + (index / Math.max(1, profile.length - 1)) * 860
      const terrainOffset = ((routePoint[1] - latMin) / latRange - .5) * 55
      const y = 405 - ((value - min) / range) * 290 - terrainOffset
      return [x, y] as const
    })
  }, [course.route, profile])
  const modelLine = modelPoints.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const modelCurrent = modelPoints[Math.min(modelPoints.length - 1, Math.round(progress * (modelPoints.length - 1)))]

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

  return (
    <div className={`three-d-modal three-d-mode-${mode}`} role="dialog" aria-modal="true" aria-labelledby="three-d-title">
      <div ref={containerRef} className="three-d-map" aria-label={`${course.name}の3D地形`} />
      {mapError && <div className="three-d-error"><strong>3D表示を利用できません</strong><p>{mapError}</p><button onClick={onClose}>詳細へ戻る</button></div>}
      <header className="three-d-header"><div><p className="eyebrow">3D COURSE PREVIEW</p><h2 id="three-d-title">{course.name}</h2><span>ルートの見え方を切り替えできます</span></div><button className="icon-button" onClick={onClose} aria-label="3D表示を閉じる">×</button></header>
      <nav className="three-d-tabs" aria-label="3D表示モード">
        {([['overview', '俯瞰'], ['preview', '走行プレビュー'], ['elevation', '標高同期'], ['model', 'ルート模型']] as [ViewMode, string][]).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); if (value !== 'preview') setPlaying(false) }}>{label}</button>)}
      </nav>
      {mode === 'preview' && <section className="preview-panel" aria-label="走行プレビュー操作"><div><strong>{Math.round(progress * 100)}%</strong><span>{currentElevation}m · 残り {((1 - progress) * course.distanceKm).toFixed(1)}km</span></div><input aria-label="走行プレビュー位置" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => selectProgress(Number(event.target.value))} /><button onClick={() => { if (progress >= 1) setProgress(0); setPlaying((value) => !value) }}>{playing ? '一時停止' : progress >= 1 ? '最初から' : '再生'}</button></section>}
      {mode === 'elevation' && <section className="elevation-sync-panel" aria-label="標高同期ビュー"><div className="sync-meta"><strong>{currentElevation}m</strong><span>距離 {((progress * course.distanceKm)).toFixed(1)} / {course.distanceKm}km</span><span>地図上の白い点と同期</span></div><svg viewBox="0 0 900 260" role="img" aria-label={`${course.name}の標高同期グラフ`} preserveAspectRatio="none"><polyline points={profileLine} fill="none" stroke="#f2d16b" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><line x1={`${24 + progress * 852}`} x2={`${24 + progress * 852}`} y1="15" y2="245" stroke="#fff" strokeDasharray="5 6" strokeWidth="3" /><circle cx={`${24 + progress * 852}`} cy="130" r="9" fill="#fff" /></svg><input aria-label="標高グラフ上の位置" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => selectProgress(Number(event.target.value))} /></section>}
      {mode === 'model' && <section className="route-model-panel" aria-label="ルート模型"><div className="model-title"><strong>距離 × 標高 × カーブ</strong><span>コース全体の形状を模型として確認</span></div><svg viewBox="0 0 1000 480" role="img" aria-label={`${course.name}のルート模型`}><defs><linearGradient id="model-route" x1="0" x2="1"><stop offset="0" stopColor="#62c397" /><stop offset=".5" stopColor="#f2d16b" /><stop offset="1" stopColor="#d3523c" /></linearGradient></defs><polyline points={modelLine} fill="none" stroke="#0008" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" /><polyline points={modelLine} fill="none" stroke="url(#model-route)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" /><circle cx={modelCurrent[0]} cy={modelCurrent[1]} r="12" fill="#fff" /><text x="55" y="450">START</text><text x="900" y="58">GOAL</text><text x="475" y="455">距離 {course.distanceKm}km</text><text x="75" y="70">標高 {course.minElevation}m</text><text x="780" y="120">最高 {course.maxElevation}m</text></svg></section>}
      <div className="three-d-controls"><label>地形強調 <input type="range" min="1" max="2.5" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} /><b>{exaggeration.toFixed(1)}×</b></label><button onClick={resetView}>全体を俯瞰</button></div>
      <div className="three-d-legend"><span><i className="start" />START</span><span><i className="route" />ROUTE</span><span><i className="goal" />GOAL</span><b>高低差 {course.maxElevation - course.minElevation}m</b></div>
    </div>
  )
}
