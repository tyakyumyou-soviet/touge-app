import type { Coordinate, TollStatus } from '../types'
import { distanceKm, routeDistanceKm } from './course'
import { distanceToRouteKm } from './courseSearch'
import { fetchElevationProfile } from './elevation'
import { proposalCountFor, type DriveProposal, type DriveProposalRequest } from './recommendations'

interface OverpassWay {
  type: 'way'
  id: number
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
}

interface OverpassResult { elements?: OverpassWay[] }

interface OsrmRouteResponse {
  code?: string
  routes?: Array<{
    distance?: number
    duration?: number
    geometry?: { coordinates?: Array<[number, number]> }
  }>
}

// Requesting a 25km circle at once makes public Overpass instances time out
// regularly in populated regions.  A 15km search is still useful for a
// driving-area suggestion and keeps the road scan responsive.
const MAX_DISCOVERY_RADIUS_KM = 12
const CLIENT_REQUEST_TIMEOUT_MS = 10_000
const ROAD_DISCOVERY_RELAY = import.meta.env.DEV
  ? '/api/road-discovery'
  : '/.netlify/functions/road-discovery'

export function buildRoadDiscoveryQuery(center: Coordinate, radiusKm: number, maxWays = 80): string {
  const radius = Math.round(Math.min(MAX_DISCOVERY_RADIUS_KM, Math.max(2, radiusKm)) * 1000)
  const [lng, lat] = center
  // Avoid motorways, service roads, trails, private/no-access roads, tunnels,
  // and areas.  `out geom` returns the actual OSM way geometry rather than a
  // router's potentially unrelated shortcut.
  return `[out:json][timeout:20];
way(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})
  ["highway"~"^(primary|secondary|tertiary|unclassified)$"]
  ["motor_vehicle"!~"^(no|private)$"]
  ["access"!~"^(no|private)$"]
  ["service"!~"^(parking|driveway)$"]
  ["tunnel"!="yes"]
  ["area"!="yes"];
// Limit the returned geometry instead of downloading every road segment in a
// 12km circle.  This is the main protection against Overpass timeouts; the
// score filter below still selects the most suitable of these road candidates.
out tags geom ${Math.min(120, Math.max(25, Math.round(maxWays)))};`
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

function routeCandidateTargets(center: Coordinate, radiusKm: number, count: number): Array<{ start: Coordinate, goal: Coordinate }> {
  const distance = Math.min(8, Math.max(2.5, Math.min(radiusKm, MAX_DISCOVERY_RADIUS_KM) * .55))
  const latitudeScale = distance / 111
  const longitudeScale = distance / (111 * Math.max(.35, Math.cos(center[1] * Math.PI / 180)))
  const bearings = [22, 94, 166, 238, 310]
  return bearings.slice(0, count).map((bearing) => {
    const radians = bearing * Math.PI / 180
    const lng = Math.sin(radians) * longitudeScale
    const lat = Math.cos(radians) * latitudeScale
    // Using a point on each side of the search centre produces a genuine
    // drivable route through the requested area, rather than a straight line
    // between two arbitrary map points.
    return { start: [center[0] - lng * .65, center[1] - lat * .65], goal: [center[0] + lng, center[1] + lat] }
  })
}

async function fetchRoutedRoad(stops: Coordinate[]): Promise<{ route: Coordinate[], distanceKm: number } | null> {
  const coordinates = stops.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`公開道路ルーティングエラー (${response.status})`)
  const data = await response.json() as OsrmRouteResponse
  const candidate = data.routes?.[0]
  const route = (candidate?.geometry?.coordinates ?? []).map(([lng, lat]) => [lng, lat] as Coordinate)
  const distanceMeters = candidate?.distance
  if (data.code !== 'Ok' || route.length < 3 || !Number.isFinite(distanceMeters)) return null
  return { route, distanceKm: Number((distanceMeters! / 1000).toFixed(1)) }
}

async function discoverRoutedDriveProposals(request: DriveProposalRequest): Promise<DriveProposal[]> {
  const count = proposalCountFor(request)
  const targets = routeCandidateTargets(request.center, request.radiusKm, count)
  const settled = await Promise.allSettled(targets.map(async ({ start, goal }, index) => {
    // Required points are routing stops, not a ranking hint.  Keep their
    // entered order so every generated candidate physically passes each one.
    const mandatoryStops = request.requiredPoints.map((point) => point.coordinate)
    const routed = await fetchRoutedRoad([start, request.center, ...mandatoryStops, goal])
    if (!routed || routed.distanceKm > request.maxDistanceKm) return null
    // A router may snap an unreachable coordinate to a distant road. Do not
    // present such a route as satisfying the user's mandatory-stop request.
    if (mandatoryStops.some((point) => distanceToRouteKm(point, routed.route) > .25)) return null
    if (request.toll !== 'all') return null
    const validation = validateDiscoveredRoad(routed.route)
    if (validation.warnings.some((warning) => warning !== '候補区間が短すぎます')) return null
    const elevation = await fetchElevationProfile(sampled(routed.route, 18))
    const range = elevation.values.length ? Math.max(...elevation.values) - Math.min(...elevation.values) : 0
    const curve = validation.curveDensity
    const width = 3.4
    const styleScore = request.style === 'winding'
      ? curve * 7 + range / 220
      : request.style === 'easy'
        ? width * 1.6 - curve * .35
        : curve * 4 + width + range / 480
    return {
      id: `router-${Math.round(request.center[0] * 10000)}-${Math.round(request.center[1] * 10000)}-${index}`,
      source: 'openstreetmap' as const,
      name: `${Math.round(request.radiusKm)}km圏のドライブ候補 ${index + 1}`,
      area: '公開道路データから探索',
      route: routed.route,
      waypoints: proposalWaypoints(routed.route, mandatoryStops),
      elevationProfile: elevation.values,
      elevationSource: elevation.source,
      labels: ['探索中心', `${routed.distanceKm.toFixed(1)}km区間`],
      tollStatus: 'unknown' as const,
      distanceKm: routed.distanceKm,
      score: styleScore,
      reasons: [
        '公開道路データから道路に沿って生成',
        ...(request.requiredPoints.length ? [`必須地点 ${request.requiredPoints.map((point) => point.label).join('、')} を通過`] : []),
        `カーブ密度 ${curve.toFixed(1)} 回/km`,
        `高低差 ${Math.round(range)}m`,
      ],
      validation: { ...validation, elevationRangeM: Math.round(range), elevationSource: elevation.source },
    } satisfies DriveProposal
  }))
  return settled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
}

/**
 * The routing engine fills in the road between these points. Keep only enough
 * anchors to retain the intended road section: dense stop lists make an
 * automatically proposed route impossible to inspect or edit.
 */
export function proposalWaypoints(route: Coordinate[], requiredPoints: Coordinate[] = []): Coordinate[] {
  const length = routeDistanceKm(route)
  const count = Math.min(6, Math.max(2, Math.ceil(length / 8) + 1))
  const requiredAtIndex = new Map<number, Coordinate>()
  for (const required of requiredPoints) {
    const index = route.reduce((best, point, candidate) => (
      distanceKm(point, required) < distanceKm(route[best], required) ? candidate : best
    ), 0)
    // Preserve the driver-selected coordinate instead of the router's nearby
    // snapped vertex. When the proposal is edited/saved, this makes OSRM route
    // through the exact mandatory point again.
    requiredAtIndex.set(index, required)
  }
  const sampleIndices = Array.from({ length: count }, (_, index) => Math.round(index * (route.length - 1) / Math.max(1, count - 1)))
  return [...new Set([0, ...sampleIndices, ...requiredAtIndex.keys(), route.length - 1])]
    .sort((left, right) => left - right)
    .map((index) => requiredAtIndex.get(index) ?? route[index])
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
  const data = encodeURIComponent(query)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS)
  try {
    // Never fall back to a browser-to-Overpass request in production. Public
    // mirrors generally reject that with CORS, which both fails discovery and
    // pollutes the console. The Netlify relay owns mirror retries instead.
    const response = await fetch(`${ROAD_DISCOVERY_RELAY}?data=${data}`, { method: 'GET', signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`道路データ取得エラー (${response.status})`)
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('道路データの応答形式が不正です')
    const result = await response.json() as OverpassResult
    if (!Array.isArray(result.elements)) throw new Error('道路データの応答形式が不正です')
    return result
  } finally { window.clearTimeout(timer) }
}

/**
 * Discovers *new* road candidates from OpenStreetMap using Overpass. Candidates
 * remain local to the builder until the driver reviews and saves one; they are
 * never automatically published as verified courses.
 */
export async function discoverExternalDriveProposals(request: DriveProposalRequest): Promise<DriveProposal[]> {
  const count = proposalCountFor(request)
  const fromOverpass = async () => {
    const result = await fetchOverpass(buildRoadDiscoveryQuery(request.center, request.radiusKm, Math.max(40, count * 24)))
    const raw = candidatesFromWays((result.elements ?? []).filter((item) => item.type === 'way'), request)
    const enriched = await Promise.all(raw.slice(0, count).map(async (item) => {
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
      // Keep the complete OSM geometry for preview rendering. The compact
      // waypoint list is only for the editor and must never replace the line.
      route: item.route,
      waypoints: proposalWaypoints(item.route),
      elevationProfile: elevation.values,
      elevationSource: elevation.source,
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
    const next = enriched.sort((a, b) => b.score - a.score).slice(0, count)
    if (!next.length) throw new Error('条件に合う外部道路が見つかりませんでした')
    return next
  }
  const fromRoutedRoads = async () => {
    const next = await discoverRoutedDriveProposals(request)
    if (!next.length) throw new Error('公開道路ルーティングで条件に合う道路が見つかりませんでした')
    return next
  }
  // A standalone OSM way cannot guarantee traversal of an arbitrary point.
  // With required stops, use OSRM exclusively so that the constraint remains
  // true in both the preview and the subsequently saved route.
  if (request.requiredPoints.length) return fromRoutedRoads()
  // Overpassは道路のタグ・形状に強く、OSRMは実際に走行可能な接続道路を
  // すぐ返せる。どちらか先に有効な新規候補を返した方を採用する。
  try {
    return await Promise.any([fromOverpass(), fromRoutedRoads()])
  } catch {
    throw new Error('外部道路データから条件に合う新しいコースを見つけられませんでした')
  }
}
