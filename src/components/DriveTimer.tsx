import { useEffect, useRef, useState } from 'react'
import type { Coordinate, Course } from '../types'
import { useMobileSheet } from '../hooks/useMobileSheet'

const STORAGE_KEY = 'touge-drive-times-v1'
interface DriveTime { id: string; courseId: string; durationMs: number; mode: 'manual' | 'auto'; finishedAt: string }

function distanceMeters(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad)
  const y = (b[1] - a[1]) * rad
  return Math.hypot(x, y) * 6371000
}

function readTimes(courseId: string): DriveTime[] {
  try { return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DriveTime[]).filter((item) => item.courseId === courseId).slice(-5).reverse() }
  catch { return [] }
}

interface Props { course: Course; onClose: () => void }

export function DriveTimer({ course, onClose }: Props) {
  const sheet = useMobileSheet()
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('手動で開始できます')
  const [history, setHistory] = useState<DriveTime[]>(() => readTimes(course.id))
  const startedAt = useRef<number | null>(null)
  const runningRef = useRef(false)
  const elapsedRef = useRef(0)
  const autoArmed = useRef(false)
  const leftStartArea = useRef(false)
  const watch = useRef<number | null>(null)

  useEffect(() => {
    if (!running || startedAt.current === null) return
    const timer = window.setInterval(() => { elapsedRef.current = Date.now() - startedAt.current!; setElapsed(elapsedRef.current) }, 250)
    return () => window.clearInterval(timer)
  }, [running])
  useEffect(() => () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current) }, [])

  function clearWatch() { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); watch.current = null }
  function begin() {
    startedAt.current = Date.now() - elapsedRef.current
    runningRef.current = true
    setRunning(true)
    setStatus('計測中')
  }
  function saveResult(durationMs: number) {
    if (durationMs < 1000) return
    const item: DriveTime = { id: crypto.randomUUID(), courseId: course.id, durationMs, mode, finishedAt: new Date().toISOString() }
    let all: DriveTime[] = []
    try { all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DriveTime[] } catch { /* start a clean local history */ }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...all, item].slice(-100)))
    setHistory(readTimes(course.id))
  }
  function stop(message = '計測を停止しました', save = true) {
    const duration = startedAt.current === null ? elapsedRef.current : Date.now() - startedAt.current
    elapsedRef.current = duration
    setElapsed(duration)
    runningRef.current = false
    setRunning(false)
    startedAt.current = null
    if (save) saveResult(duration)
    setStatus(message)
  }
  function reset() {
    clearWatch(); runningRef.current = false; autoArmed.current = false; leftStartArea.current = false
    startedAt.current = null; elapsedRef.current = 0; setRunning(false); setElapsed(0); setStatus('リセットしました')
  }
  function startAutomatic() {
    if (!navigator.geolocation || course.route.length < 2) { setStatus('この端末では位置情報を利用できません'); return }
    clearWatch(); setMode('auto'); autoArmed.current = true; leftStartArea.current = false
    setStatus('始点から120m以内に入ると自動開始します')
    const start = course.route[0], goal = course.route.at(-1)!
    watch.current = navigator.geolocation.watchPosition((position) => {
      const current: Coordinate = [position.coords.longitude, position.coords.latitude]
      const fromStart = distanceMeters(current, start)
      if (!runningRef.current && autoArmed.current && fromStart <= 120) { begin(); autoArmed.current = false }
      if (runningRef.current && fromStart >= 200) leftStartArea.current = true
      if (runningRef.current && leftStartArea.current && distanceMeters(current, goal) <= 120) { stop('ゴール付近を検出して停止しました'); clearWatch() }
    }, () => setStatus('位置情報を取得できません。手動計測に切り替えてください。'), { enableHighAccuracy: true, maximumAge: 5000 })
  }
  function changeMode(next: 'manual' | 'auto') {
    if (runningRef.current) stop('モード変更のため停止しました')
    clearWatch(); setMode(next); autoArmed.current = false; setStatus(next === 'manual' ? '手動で開始できます' : '自動計測を待機してください')
  }
  const format = (value: number) => { const seconds = Math.floor(value / 1000); return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }

  return <div className="modal-backdrop" role="presentation"><section className={`modal drive-timer ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="drive-timer-title" {...sheet.dragProps}><div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">DRIVE TIMER</p><h2 id="drive-timer-title">{course.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header></div><div className="timer-value" aria-live="off">{format(elapsed)}</div><div className="timer-mode"><button className={mode === 'manual' ? 'active' : ''} onClick={() => changeMode('manual')}>手動</button><button className={mode === 'auto' ? 'active' : ''} onClick={() => changeMode('auto')}>位置情報で自動</button></div><p role="status">{status}</p><div className="timer-actions"><button className="button secondary" onClick={reset}>リセット</button><button className="button primary" onClick={() => running ? stop() : mode === 'auto' ? startAutomatic() : begin()}>{running ? '停止して記録' : mode === 'auto' ? '自動計測を待機' : '開始'}</button></div>{history.length > 0 && <section className="timer-history"><h3>このコースの最近の記録</h3>{history.map((item) => <div key={item.id}><strong>{format(item.durationMs)}</strong><span>{item.mode === 'auto' ? '自動' : '手動'} · {new Date(item.finishedAt).toLocaleDateString('ja-JP')}</span></div>)}</section>}<small>記録は端末に保存されるためオフラインでも利用できます。位置共有とは独立しており、他のユーザーには公開されません。</small></section></div>
}
