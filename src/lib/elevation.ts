import type { Coordinate } from '../types'
import { distanceKm } from './course'

export interface ElevationResult {
  values: number[]
  source: '国土地理院 標高API' | '地形傾向による推定'
}

function sampleRoute(route: Coordinate[], count: number): Coordinate[] {
  if (route.length <= 1) return route
  const cumulative = [0]
  for (let index = 1; index < route.length; index += 1) cumulative.push(cumulative[index - 1] + distanceKm(route[index - 1], route[index]))
  const total = cumulative.at(-1) ?? 0
  if (total <= 0) return [route[0], route.at(-1)!]
  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = (sampleIndex / Math.max(1, count - 1)) * total
    const upper = cumulative.findIndex((value) => value >= target)
    if (upper <= 0) return route[0]
    if (upper < 0) return route.at(-1)!
    const lower = upper - 1
    const amount = (target - cumulative[lower]) / Math.max(.000001, cumulative[upper] - cumulative[lower])
    return [route[lower][0] + (route[upper][0] - route[lower][0]) * amount, route[lower][1] + (route[upper][1] - route[lower][1]) * amount]
  })
}

function smooth(values: number[]): number[] {
  if (values.length < 3) return values.map(Math.round)
  const median = values.map((_, index) => {
    const window = values.slice(Math.max(0, index - 1), Math.min(values.length, index + 2)).sort((a, b) => a - b)
    return window[Math.floor(window.length / 2)]
  })
  return median.map((value, index) => Math.round((median[Math.max(0, index - 1)] + value * 2 + median[Math.min(median.length - 1, index + 1)]) / 4))
}

function fallbackProfile(points: Coordinate[]): number[] {
  if (!points.length) return []
  const baseLat = points[0][1]; const baseLng = points[0][0]
  return smooth(points.map(([lng, lat]) => Math.max(0, 180 + (lat - baseLat) * 4200 + (lng - baseLng) * 650)))
}

async function fetchPointElevation([lng, lat]: Coordinate): Promise<number | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetch(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng.toFixed(7)}&lat=${lat.toFixed(7)}&outtype=JSON`, { signal: controller.signal })
    if (!response.ok) return null
    const data = await response.json() as { elevation?: number | string }
    const elevation = Number(data.elevation)
    return Number.isFinite(elevation) ? elevation : null
  } catch { return null } finally { window.clearTimeout(timer) }
}

export async function fetchElevationProfile(route: Coordinate[]): Promise<ElevationResult> {
  if (route.length < 2) return { values: [], source: '地形傾向による推定' }
  const total = route.slice(1).reduce((sum, point, index) => sum + distanceKm(route[index], point), 0)
  // Sample at roughly 500 m intervals. This is fine enough to retain a pass or
  // ridge while keeping a firm ceiling on requests to the public endpoint.
  const points = sampleRoute(route, Math.min(48, Math.max(16, Math.ceil(total * 2) + 1)))
  const results: Array<number | null> = Array(points.length).fill(null)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(6, points.length) }, async () => {
    while (cursor < points.length) {
      const index = cursor; cursor += 1
      results[index] = await fetchPointElevation(points[index])
    }
  }))
  const valid = results.filter((value): value is number => value !== null)
  if (valid.length < Math.max(4, points.length * .6)) return { values: fallbackProfile(points), source: '地形傾向による推定' }
  const filled = results.map((value, index) => {
    if (value !== null) return value
    let before = index - 1; let after = index + 1
    while (before >= 0 && results[before] === null) before -= 1
    while (after < results.length && results[after] === null) after += 1
    if (before < 0) return results[after] as number
    if (after >= results.length) return results[before] as number
    const amount = (index - before) / (after - before)
    return (results[before] as number) + ((results[after] as number) - (results[before] as number)) * amount
  })
  return { values: smooth(filled), source: '国土地理院 標高API' }
}

export function isSuspiciousElevationProfile(values: number[]): boolean {
  if (values.length < 30) return false
  const deltas = values.slice(1).map((value, index) => value - values[index])
  const large = deltas.filter((value) => Math.abs(value) > 45).length / deltas.length
  const reversals = deltas.slice(1).filter((value, index) => value * deltas[index] < 0).length / Math.max(1, deltas.length - 1)
  return large > .35 && reversals > .5
}
