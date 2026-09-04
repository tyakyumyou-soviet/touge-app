import type { Coordinate } from '../types'
import { distanceKm } from './course'

export interface CurrentRoadTraffic {
  summary: string
  updatedAt: string
  sourceName: string
  sourceUrl: string
  sensorDistanceKm: number
}

interface TrafficFeature {
  geometry?: { coordinates?: unknown }
  properties?: Record<string, unknown>
}

const SOURCE_URL = 'https://www.jartic-open-traffic.org/'
const ENDPOINT = import.meta.env.DEV ? '/api/jartic-traffic' : '/.netlify/functions/road-live'

function hourCode(date: Date) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}${value('month')}${value('day')}${value('hour')}00`
}

function coordinatesOf(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return []
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) return [[Number(value[0]), Number(value[1])]]
  return value.flatMap(coordinatesOf)
}

function numeric(properties: Record<string, unknown>, key: string) {
  const value = Number(properties[key])
  return Number.isFinite(value) ? value : 0
}

export async function fetchCurrentRoadTraffic(route: Coordinate[]): Promise<CurrentRoadTraffic | null> {
  if (!route.length) return null
  const lngs = route.map(([lng]) => lng)
  const lats = route.map(([, lat]) => lat)
  const padding = .035
  const bounds = [Math.min(...lngs) - padding, Math.min(...lats) - padding, Math.max(...lngs) + padding, Math.max(...lats) + padding]
  // One-hour values become available about 20 minutes after observation. Use
  // the preceding completed hour so a valid reading is not mistaken for a
  // missing sensor while the current hour is still being assembled.
  const observed = new Date(Date.now() - 90 * 60 * 1000)
  const code = hourCode(observed)
  const filter = `道路種別=3 AND 時間コード=${code} AND BBOX(ジオメトリ,${bounds.map((value) => value.toFixed(5)).join(',')},'EPSG:4326')`
  const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 't_travospublic_measure_1h', srsName: 'EPSG:4326', outputFormat: 'application/json', exceptions: 'application/json', cql_filter: filter })
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json() as { features?: TrafficFeature[] }
    const candidates = (data.features ?? []).flatMap((feature) => {
      const properties = feature.properties ?? {}
      if (String(properties['上り・欠測'] ?? '0') === '1' && String(properties['下り・欠測'] ?? '0') === '1') return []
      const points = coordinatesOf(feature.geometry?.coordinates)
      if (!points.length) return []
      const nearest = Math.min(...points.flatMap((point) => route.map((routePoint) => distanceKm(point, routePoint))))
      const total = ['上り・小型交通量', '上り・大型交通量', '上り・車種判別不能交通量', '下り・小型交通量', '下り・大型交通量', '下り・車種判別不能交通量']
        .reduce((sum, key) => sum + numeric(properties, key), 0)
      return total > 0 ? [{ nearest, total }] : []
    }).sort((left, right) => left.nearest - right.nearest)
    const match = candidates[0]
    if (!match || match.nearest > 12) return null
    return {
      summary: `${match.total.toLocaleString('ja-JP')}台/時（約${match.nearest.toFixed(1)}km先）`,
      updatedAt: `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)} ${code.slice(8, 10)}:00`,
      sourceName: '国土交通省交通量API', sourceUrl: SOURCE_URL, sensorDistanceKm: match.nearest,
    }
  } finally { window.clearTimeout(timer) }
}
