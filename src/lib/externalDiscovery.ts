import type { Coordinate, TollStatus } from '../types'
import { distanceKm, routeDistanceKm } from './course'
import { fetchElevationProfile } from './elevation'
import type { DriveProposal, DriveProposalRequest } from './recommendations'

interface OverpassWay {
  type: 'way'
  id: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
}

interface OverpassResult { elements?: OverpassWay[] }

// Requesting a 25km circle at once makes public Overpass instances time out
// regularly in populated regions.  A 15km search is still useful for a
// driving-area suggestion and keeps the road scan responsive.
const MAX_DISCOVERY_RADIUS_KM = 12
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export function buildRoadDiscoveryQuery(center: Coordinate, radiusKm: number): string {
  const radius = Math.round(Math.min(MAX_DISCOVERY_RADIUS_KM, Math.max(2, radiusKm)) * 1000)
  const [lng, lat] = center
  // Avoid motorways, service roads, trails, private/no-access roads, tunnels,
  // and areas.  `out geom` returns the actual OSM way geometry rather than a
  // router's potentially unrelated shortcut.
  return `[out:json][timeout:45];
way(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})
  ["highway"~"^(primary|secondary|tertiary|unclassified)$"]
  ["motor_vehicle"!~"^(no|private)$"]
  ["access"!~"^(no|private)$"]
  ["service"!~"^(parking|driveway)$"]
  ["tunnel"!="yes"]
  ["area"!="yes"];
out tags geom;`
}

function asRoute(geometry: OverpassWay['geometry']): Coordinate[] {
  return (geometry ?? []).map((item) => [item.lon, item.lat] as Coordinate)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
}

function highwayWidthScore(tags: Record<string, string>): number {
  const lanes = Number(tags.lanes)
  if (Number.isFinite(lanes) && lanes >= 2) return 4.2
  if (tags.highway === 'primary') return 4.3
  if (tags.highway === 'secondary') return 3.8
  if (tags.highway === 'tertiary') return 3.3
  return 2.8
}

function tollFromTags(tags: Record<string, string>): TollStatus {
  if (tags.toll === 'yes') return 'toll'
  if (tags.toll === 'no') return 'free'
  return 'unknown'
}

function curveDensity(route: Coordinate[]): number {
  if (route.length < 3) return 0
  let curves = 0
  for (let index = 2; index < route.length; index += 1) {
    const a = route[index - 2]; const b = route[index - 1]; const c = route[index]
    const first = [b[0] - a[0], b[1] - a[1]
    ]
    const second = [c[0] - b[0], c[1] - b[1]]
    const angle = Math.abs(Math.atan2(first[0] * second[1] - first[1] * second[0], first[0] * second[0] + first[1] * second[1]))
    if (angle > 0.16) curves += 1
  }
  return curves / Math.max(.1, routeDistanceKm(route))
}

export function validateDiscoveredRoad(route: Coordinate[]) {
  const length = routeDistanceKm(route)
  const gaps = route.slice(1).map((point, index) => distanceKm(route[index], point))
  const maxGapKm = Math.max(0, ...gaps)
  const warnings: string[] = []
  if (route.length < 3) warnings.push('道路形状の点が不足しています')
  if (length < 1.5) warnings.push('候補区間が短すぎます')
  // A very large jump is normally a malformed OSM geometry or an incomplete
  // relation. Reject it rather than pretending a straight line is drivable.
  if (maxGapKm > 1.2) warnings.push('道路形状に大きな欠落があります')
  return { checked: true, roadLengthKm: Number(length.toFixed(1)), curveDensity: Number(curveDensity(route).toFixed(2)), maxGapKm: Number(maxGapKm.toFixed(2)), warnings }
}

function sampled(route: Coordinate[], max = 14): Coordinate[] {
  if (route.length <= max) return route
  return Array.from({ length: max }, (_, index) => route[Math.round(index * (route.length - 1) / (max - 1))])
}

function candidatesFromWays(ways: OverpassWay[], request: DriveProposalRequest) {
  return ways.map((way) => {
    const tags = way.tags ?? {}
    const route = asRoute(way.geometry)
    const validation = validateDiscoveredRoad(route)
    const width = highwayWidthScore(tags)
    const styleScore = request.style === 'winding'
      ? validation.curveDensity * 7 + width * .25
      : request.style === 'easy'
        ? width * 1.6 - validation.curveDensity * .35
        : validation.curveDensity * 4 + width
    return { way, tags, route, validation, width, score: styleScore }
  })
    .filter((item) => item.validation.warnings.length === 0)
    .filter((item) => item.validation.roadLengthKm <= request.maxDistanceKm)
    .filter((item) => request.toll === 'all' || tollFromTags(item.tags) === request.toll)
    .sort((a, b) => b.score - a.score)
    // One road often occurs in multiple adjacent way fragments. Keep a compact
    // representative set while preferring different named/ref'd roads.
    .filter((item, index, items) => items.findIndex((other) => (other.tags.name || other.tags.ref || other.way.id) === (item.tags.name || item.tags.ref || item.way.id)) === index)
    .slice(0, 8)
}

async function fetchOverpass(query: string): Promise<OverpassResult> {
  let lastError: unknown
  const data = encodeURIComponent(query)
  const requests: Array<{ endpoint: string; init: RequestInit }> = [
    // Netlify serves this same-origin relay in production.  It avoids browser
    // CORS/rate-limit failures while retaining the same public OSM data source.
    { endpoint: `/api/road-discovery?data=${data}`, init: { method: 'GET' } },
    ...OVERPASS_ENDPOINTS.map((endpoint) => ({ endpoint: `${endpoint}?data=${data}`, init: { method: 'GET' } })),
  ]
  for (const { endpoint, init } of requests) {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 50_000)
    try {
      const response = await fetch(endpoint, { ...init, signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`道路データ取得エラー (${response.status})`)
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('道路データの応答形式が不正です')
      const result = await response.json() as OverpassResult
      if (!Array.isArray(result.elements)) throw new Error('道路データの応答形式が不正です')
      return result
    } catch (error) { lastError = error } finally { window.clearTimeout(timer) }
  }
  throw new Error(lastError instanceof Error ? lastError.message : '外部道路データを取得できませんでした')
}

/**
 * Discovers *new* road candidates from OpenStreetMap using Overpass. Candidates
 * remain local to the builder until the driver reviews and saves one; they are
 * never automatically published as verified courses.
 */
export async function discoverExternalDriveProposals(request: DriveProposalRequest): Promise<DriveProposal[]> {
  const result = await fetchOverpass(buildRoadDiscoveryQuery(request.center, request.radiusKm))
  const raw = candidatesFromWays((result.elements ?? []).filter((item) => item.type === 'way'), request)
  const enriched = await Promise.all(raw.slice(0, 5).map(async (item) => {
    const elevation = await fetchElevationProfile(sampled(item.route, 18))
    const range = elevation.values.length ? Math.max(...elevation.values) - Math.min(...elevation.values) : 0
    const gradeBonus = Math.min(2, range / 250)
    const score = item.score + gradeBonus
    const name = item.tags.name || item.tags.ref || `${Math.round(request.radiusKm)}km圏のワインディング`
    const tollStatus = tollFromTags(item.tags)
    return {
      id: `osm-${item.way.id}`,
      source: 'openstreetmap' as const,
      name,
      area: item.tags.ref ? `${item.tags.ref} · OpenStreetMap道路候補` : 'OpenStreetMap道路候補',
      route: sampled(item.route),
      labels: [name, `${item.validation.roadLengthKm}km区間`],
      tollStatus,
      distanceKm: item.validation.roadLengthKm,
      score,
      reasons: [
        `外部道路データから発見（${item.tags.highway ?? 'road'}）`,
        `カーブ密度 ${item.validation.curveDensity.toFixed(1)} 回/km`,
        `推定道幅スコア ${item.width.toFixed(1)} / 5`,
        `高低差 ${Math.round(range)}m`,
      ],
      validation: { ...item.validation, elevationRangeM: Math.round(range), elevationSource: elevation.source },
    } satisfies DriveProposal
  }))
  return enriched.sort((a, b) => b.score - a.score).slice(0, 3)
}
