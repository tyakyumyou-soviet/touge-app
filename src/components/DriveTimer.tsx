import { useEffect, useRef, useState } from 'react'
import type { Coordinate, Course } from '../types'

function distanceMeters(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad)
  const y = (b[1] - a[1]) * rad
  return Math.hypot(x, y) * 6371000
}

interface Props { course: Course; onClose: () => void }

export function DriveTimer({ course, onClose }: Props) {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('手動で開始できます')
  const startedAt = useRef<number | null>(null)
  const watch = useRef<number | null>(null)
  useEffect(() => {
    if (!running || startedAt.current === null) return
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt.current!), 250)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current) }, [])
  function begin() { startedAt.current = Date.now() - elapsed; setRunning(true); setStatus('計測中') }
  function stop(message = '計測を停止しました') { if (startedAt.current !== null) setElapsed(Date.now() - startedAt.current); setRunning(false); startedAt.current = null; setStatus(message) }
  function startAutomatic() {
    if (!navigator.geolocation || !course.route.length) { setStatus('この端末では位置情報を利用できません'); return }
    setMode('auto'); setStatus('始点から120m以内で自動開始します')
    const start = course.route[0], goal = course.route.at(-1)!
    watch.current = navigator.geolocation.watchPosition((position) => {
      const current: Coordinate = [position.coords.longitude, position.coords.latitude]
      if (!running && distanceMeters(current, start) <= 120) begin()
      if (running && distanceMeters(current, goal) <= 120) { stop('ゴール付近を検出して停止しました'); if (watch.current !== null) navigator.geolocation.clearWatch(watch.current) }
    }, () => setStatus('位置情報を取得できません。手動計測に切り替えてください。'), { enableHighAccuracy: true, maximumAge: 5000 })
  }
  const seconds = Math.floor(elapsed / 1000)
  const time = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return <div className="modal-backdrop" role="presentation"><section className="modal drive-timer" role="dialog" aria-modal="true" aria-labelledby="drive-timer-title"><header><div><p className="eyebrow">DRIVE TIMER</p><h2 id="drive-timer-title">{course.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header><div className="timer-value">{time}</div><div className="timer-mode"><button className={mode === 'manual' ? 'active' : ''} onClick={() => { setMode('manual'); if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current) }}>手動</button><button className={mode === 'auto' ? 'active' : ''} onClick={startAutomatic}>位置情報で自動</button></div><p>{status}</p><div className="timer-actions"><button className="button secondary" onClick={() => { stop('リセットしました'); setElapsed(0) }}>リセット</button><button className="button primary" onClick={() => running ? stop() : mode === 'auto' ? startAutomatic() : begin()}>{running ? '停止' : mode === 'auto' ? '自動計測を待機' : '開始'}</button></div><small>オフラインでも端末上で計測を続けます。位置情報の共有とは独立しており、他のユーザーには公開されません。</small></section></div>
}
