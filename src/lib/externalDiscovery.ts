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
    legs?: Array<{ steps?: Array<{ distance?: number; duration?: number; name?: string }> }>
  }>
}

// Requesting a 25km circle at once makes public Overpass instances time out
// regularly in populated regions.  A 15km search is still useful for a
// driving-area suggestion and keeps the road scan responsive.
const MAX_DISCOVERY_RADIUS_KM = 12
// The production relay may retry more than one public Overpass mirror.  This
// must be longer than a single upstream attempt; otherwise the app aborts a
// healthy retry and reports a false negative before road data arrives.
const CLIENT_REQUEST_TIMEOUT_MS = 30_000
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
  ["name"]
  ["motor_vehicle"!~"^(no|private)$"]
  ["access"!~"^(no|private)$"]
  ["service"!~"^(parking|driveway)$"]
  ["sidewalk"!~"^(both|left|right)$"]
  ["lit"!="yes"]
  ["tunnel"!="yes"]
  ["area"!="yes"];
// The evaluator joins fragments by road name. Fetching anonymous ways here
// only makes the public Overpass query much heavier and those fragments cannot
// form a useful pass corridor later. Limit geometry as a second guard.
out tags geom ${Math.min(120, Math.max(25, Math.round(maxWays)))};`
}

export class RoadDiscoveryUnavailableError extends Error {
  constructor(message = '道路データサービスが混雑しています。少し待ってからもう一度お試しください') {
    super(message)
    this.name = 'RoadDiscoveryUnavailableError'
  }
}

function asRoute(geometry: OverpassWay['geometry']): Coordinate[] {
  return (geometry ?? []).map((item) => [item.lon, item.lat] as Coordinate)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
}

interface RoadChain { tags: Record<string, string>; route: Coordinate[]; wayIds: number[] }

function samePoint(left: Coordinate, right: Coordinate) {
  return distanceKm(left, right) < .035
}

function roadIdentity(tags: Record<string, string>, id: number) {
  // Ref/name preserves a real road corridor while avoiding an arbitrary walk
  // across junctions. Anonymous unclassified roads are intentionally kept as
  // isolated fragments and will normally fail the pass-quality gate.
  return tags.ref || tags.name || `anonymous-${id}`
}

/** Join adjacent OSM way fragments into a road corridor before judging it. */
export function chainRoadWays(ways: OverpassWay[]): RoadChain[] {
  const grouped = new Map<string, Array<{ id: number; tags: Record<string, string>; route: Coordinate[] }>>()
  for (const way of ways) {
    const route = asRoute(way.geometry)
    if (route.length < 2) continue
    const tags = way.tags ?? {}
    const key = roadIdentity(tags, way.id)
    grouped.set(key, [...(grouped.get(key) ?? []), { id: way.id, tags, route }])
  }
  const chains: RoadChain[] = []
  for (const group of grouped.values()) {
    const remaining = [...group]
    while (remaining.length) {
      const seed = remaining.shift()!
      let route = [...seed.route]
      const wayIds = [seed.id]
      let expanded = true
      while (expanded) {
        expanded = false
        const head = route[0]
        const tail = route.at(-1)!
        const index = remaining.findIndex((candidate) => {
          const first = candidate.route[0]; const last = candidate.route.at(-1)!
          return samePoint(last, head) || samePoint(first, head) || samePoint(first, tail) || samePoint(last, tail)
        })
        if (index < 0) continue
        const candidate = remaining.splice(index, 1)[0]
        const first = candidate.route[0]; const last = candidate.route.at(-1)!
        if (samePoint(last, head)) route = [...candidate.route.slice(0, -1), ...route]
        else if (samePoint(first, head)) route = [...candidate.route.slice().reverse().slice(0, -1), ...route]
        else if (samePoint(first, tail)) route = [...route, ...candidate.route.slice(1)]
        else route = [...route, ...candidate.route.slice().reverse().slice(1)]
        wayIds.push(candidate.id)
        expanded = true
      }
      chains.push({ tags: seed.tags, route, wayIds })
    }
  }
  return chains
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

interface RouteActivityContext {
  averageSpeedKmh?: number
  stepDensity?: number
}

function residentialRisk(tags: Record<string, string>, activity: RouteActivityContext = {}): number {
  let risk = 0
  if (tags.highway === 'unclassified') risk += 1.2
  if (!tags.ref) risk += .7
  if (!tags.name) risk += .3
  if (tags.lit === 'yes') risk += .5
  if (tags.sidewalk && tags.sidewalk !== 'no') risk += .8
  const speed = Number.parseInt(tags.maxspeed ?? '', 10)
  if (Number.isFinite(speed) && speed <= 40) risk += 1
  // OSRM does not expose population data, but frequent named manoeuvres are a
  // useful proxy for junction-heavy built-up roads. Low speed is only counted
  // together with junction density so a genuinely winding mountain road is
  // not mistaken for a town centre merely because it is slow.
  if ((activity.stepDensity ?? 0) >= 1.4) risk += 1.4
  else if ((activity.stepDensity ?? 0) >= .8) risk += .7
  if ((activity.averageSpeedKmh ?? 100) < 28 && (activity.stepDensity ?? 0) >= .6) risk += .8
  return risk
}

export interface TougeSuitability {
  eligible: boolean
  elevationRangeM: number
  totalAscentM: number
  maxGradePct: number
  curveDensity: number
  settlementRisk: number
  highPointM: number
  averageElevationM: number
  quietnessScore: number
  reasons: string[]
}

/**
 * A pass suggestion needs a hard quality gate, not merely a score.  These
 * deliberately conservative thresholds keep ordinary city/connector roads
 * out of a 峠 finder even when a router happens to draw a pleasant line.
 */
export function assessTougeSuitability(route: Coordinate[], elevations: number[], tags: Record<string, string> = {}, activity: RouteActivityContext = {}, maxDistanceKm = 40): TougeSuitability {
  const lengthKm = routeDistanceKm(route)
  const elevationRangeM = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0
  const highPointM = elevations.length ? Math.max(...elevations) : 0
  const averageElevationM = elevations.length ? elevations.reduce((sum, value) => sum + value, 0) / elevations.length : 0
  const totalAscentM = elevations.slice(1).reduce((sum, value, index) => sum + Math.max(0, value - elevations[index]), 0)
  const sampleDistanceM = elevations.length > 1 ? lengthKm * 1000 / (elevations.length - 1) : 0
  const maxGradePct = elevations.slice(1).reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - elevations[index]) / Math.max(1, sampleDistanceM) * 100), 0)
  const density = curveDensity(route)
  const settlementRisk = residentialRisk(tags, activity)
  const quietnessScore = Math.max(1, Math.min(5, 5 - settlementRisk * 1.25))
  const reasons: string[] = []
  // A 2–4km request is intentional: it should yield a compact mountain
  // section rather than be rejected by criteria meant for a 40km tour.
  const compactFactor = Math.min(1, Math.max(.25, maxDistanceKm / 12))
  if (lengthKm < Math.max(1.1, Math.min(4, maxDistanceKm * .58))) reasons.push('峠区間として短すぎます')
  if (elevationRangeM < 150 * compactFactor || totalAscentM < 180 * compactFactor) reasons.push('峠として十分な高低差がありません')
  if (highPointM < 220 * compactFactor) reasons.push('山地として十分な標高に達していません')
  if (maxGradePct < Math.max(2.2, 3.5 * compactFactor)) reasons.push('勾配が峠道の基準に達しません')
  if (density < Math.max(.14, .25 * compactFactor)) reasons.push('峠らしい連続カーブが不足しています')
  // Short pass sections often have more bends/junctions per kilometre than a
  // long tour. Keep the no-residential preference, but do not reject every
  // 4–6km mountain climb merely because its step density is high.
  if (settlementRisk > 2.1 + (1 - compactFactor) * .6) reasons.push('生活道路・市街地らしさが強すぎます')
  return {
    eligible: reasons.length === 0,
    elevationRangeM: Math.round(elevationRangeM),
    totalAscentM: Math.round(totalAscentM),
    maxGradePct: Number(maxGradePct.toFixed(1)),
    curveDensity: Number(density.toFixed(2)),
    settlementRisk: Number(settlementRisk.toFixed(1)),
    highPointM: Math.round(highPointM),
    averageElevationM: Math.round(averageElevationM),
    quietnessScore: Number(quietnessScore.toFixed(1)),
    reasons,
  }
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

/**
 * A named pass road commonly spans 15–40km. For a short-course request we
 * must evaluate its mountain sections, rather than discard the whole road for
 * exceeding the maximum distance. Each result remains an uninterrupted OSM
 * geometry, never a straight-line approximation.
 */
export function splitRoadCorridor(route: Coordinate[], maxDistanceKm: number): Coordinate[][] {
  const total = routeDistanceKm(route)
  const minimum = Math.max(1.1, Math.min(4, maxDistanceKm * .58))
  if (route.length < 3 || total <= maxDistanceKm) return [route]
  const cumulative = [0]
  for (let index = 1; index < route.length; index += 1) cumulative.push(cumulative[index - 1] + distanceKm(route[index - 1], route[index]))
  const target = Math.max(minimum, maxDistanceKm * .9)
  const stride = Math.max(.55, target * .52)
  const segments: Coordinate[][] = []
  for (let startDistance = 0; startDistance < total - minimum && segments.length < 10; startDistance += stride) {
    const start = cumulative.findIndex((distance) => distance >= startDistance)
    if (start < 0 || start >= route.length - 2) break
    let end = start + 1
    while (end < route.length - 1 && cumulative[end + 1] - cumulative[start] <= maxDistanceKm) end += 1
    const segment = route.slice(start, end + 1)
    if (segment.length >= 3 && routeDistanceKm(segment) >= minimum) segments.push(segment)
  }
  return segments.length ? segments : [route]
}

function sampled(route: Coordinate[], max = 14): Coordinate[] {
  if (route.length <= max) return route
  return Array.from({ length: max }, (_, index) => route[Math.round(index * (route.length - 1) / (max - 1))])
}

export function routeCandidateTargets(center: Coordinate, radiusKm: number, maxDistanceKm: number, count: number, startPoint?: Coordinate | null, goalPoint?: Coordinate | null): Array<{ start: Coordinate, goal: Coordinate, targetDistanceKm: number }> {
  // Probe beyond the immediate urban core.  The finder subsequently applies
  // the strict elevation/curve/quietness gate, so this wider radial probe is
  // what lets a town-centre search find the surrounding mountain pass rather
  // than repeatedly testing only flat connector roads.
  // Keep the radial probes inside the requested maximum. The previous 4km
  // floor made 2km/3km searches impossible before any road was evaluated.
  const maximum = Math.min(radiusKm, maxDistanceKm)
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
  return bearings.slice(0, count).map((bearing) => {
    // Mix compact and near-limit probes. This is especially important for a
    // 4/6km search: one fixed probe length either misses a short pass or
    // produces a road-network detour above the selected maximum.
    const factor = maxDistanceKm <= 8 ? [.31, .40, .36, .47, .34, .43, .38, .45][bearing / 45] : .42
    const distance = Math.min(12, Math.max(.7, maximum * factor))
    const latitudeScale = distance / 111
    const longitudeScale = distance / (111 * Math.max(.35, Math.cos(center[1] * Math.PI / 180)))
    const radians = bearing * Math.PI / 180
    const lng = Math.sin(radians) * longitudeScale
    const lat = Math.cos(radians) * latitudeScale
    // Using a point on each side of the search centre produces a genuine
    // drivable route through the requested area, rather than a straight line
    // between two arbitrary map points.
    return {
      start: startPoint ?? [center[0] - lng * .65, center[1] - lat * .65],
      goal: goalPoint ?? [center[0] + lng, center[1] + lat],
      targetDistanceKm: Math.min(maxDistanceKm, distance * 1.65),
    }
  })
}

async function fetchRoutedRoad(stops: Coordinate[]): Promise<{ route: Coordinate[], distanceKm: number, averageSpeedKmh: number, stepDensity: number } | null> {
  const coordinates = stops.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`公開道路ルーティングエラー (${response.status})`)
  const data = await response.json() as OsrmRouteResponse
  const candidate = data.routes?.[0]
  const route = (candidate?.geometry?.coordinates ?? []).map(([lng, lat]) => [lng, lat] as Coordinate)
  const distanceMeters = candidate?.distance
  if (data.code !== 'Ok' || route.length < 3 || !Number.isFinite(distanceMeters)) return null
  const distanceKm = distanceMeters! / 1000
  const durationHours = Number(candidate?.duration) / 3600
  const steps = candidate?.legs?.flatMap((leg) => leg.steps ?? []) ?? []
  const meaningfulSteps = steps.filter((step) => Number(step.distance) >= 35)
  return {
    route,
    distanceKm: Number(distanceKm.toFixed(1)),
    averageSpeedKmh: Number((Number.isFinite(durationHours) && durationHours > 0 ? distanceKm / durationHours : 50).toFixed(1)),
    stepDensity: Number((meaningfulSteps.length / Math.max(1, distanceKm)).toFixed(2)),
  }
}

async function discoverRoutedDriveProposals(request: DriveProposalRequest): Promise<DriveProposal[]> {
  const count = proposalCountFor(request)
  // Probe several directions even when the UI asks to show one result. A pass
  // can lie on only one side of the selected place; returning the first router
  // line was the reason a city connector could win over a real mountain road.
  const targets = routeCandidateTargets(request.center, request.radiusKm, request.maxDistanceKm, 8, request.startPoint?.coordinate, request.goalPoint?.coordinate)
  const settled = await Promise.allSettled(targets.map(async ({ start, goal, targetDistanceKm }, index) => {
    // Required points are routing stops, not a ranking hint.  Keep their
    // entered order so every generated candidate physically passes each one.
    const mandatoryStops = request.requiredPoints.map((point) => point.coordinate)
    const anchored = Boolean(request.startPoint || request.goalPoint || mandatoryStops.length)
    // The selected centre is a discovery reference, not an unrequested stop.
    // Once the driver supplies anchors, preserve their order exactly.
    const stops = anchored ? [start, ...mandatoryStops, goal] : [start, request.center, goal]
    const routed = await fetchRoutedRoad(stops)
    if (!routed || routed.distanceKm > request.maxDistanceKm) return null
    // A router may snap an unreachable coordinate to a distant road. Do not
    // present such a route as satisfying the user's mandatory-stop request.
    if (mandatoryStops.some((point) => distanceToRouteKm(point, routed.route) > .25)) return null
    if (request.toll !== 'all') return null
    const validation = validateDiscoveredRoad(routed.route)
    if (validation.warnings.some((warning) => warning !== '候補区間が短すぎます')) return null
    const elevation = await fetchElevationProfile(sampled(routed.route, 30))
    const suitability = assessTougeSuitability(routed.route, elevation.values, {}, {
      averageSpeedKmh: routed.averageSpeedKmh,
      stepDensity: routed.stepDensity,
    }, request.maxDistanceKm)
    if (!suitability.eligible) return null
    const width = 3.4
    const mountainBonus = suitability.elevationRangeM / 130 + suitability.totalAscentM / 260
      + suitability.highPointM / 420 + suitability.averageElevationM / 650
    const quietnessBonus = suitability.quietnessScore * 1.15
    const distanceFit = Math.max(0, 2 - Math.abs(routed.distanceKm - targetDistanceKm) / Math.max(1, request.maxDistanceKm) * 3)
    const styleScore = (request.style === 'winding'
      ? suitability.curveDensity * 7 + mountainBonus + quietnessBonus
      : request.style === 'easy'
        ? width * 1.6 - suitability.curveDensity * .35 + mountainBonus + quietnessBonus
        : suitability.curveDensity * 4 + width + mountainBonus + quietnessBonus) + distanceFit
    return {
      id: `router-${Math.round(request.center[0] * 10000)}-${Math.round(request.center[1] * 10000)}-${index}`,
      source: 'openstreetmap' as const,
      name: `${Math.round(request.radiusKm)}km圏の峠候補 ${index + 1}`,
      area: request.requiredPoints.length ? '必須地点を経由する山間ルート' : '公開道路データから検証した山間ルート',
      route: routed.route,
      waypoints: proposalWaypoints(routed.route, mandatoryStops),
      elevationProfile: elevation.values,
      elevationSource: elevation.source,
      labels: [request.startPoint?.label ?? '探索中心', ...request.requiredPoints.map((point) => point.label), request.goalPoint?.label ?? `標高差 ${suitability.elevationRangeM}m`],
      tollStatus: 'unknown' as const,
      distanceKm: routed.distanceKm,
      score: styleScore,
      reasons: [
        request.requiredPoints.length ? '峠適格判定を通過した必須地点経由ルート' : '峠適格判定を通過した公開道路ルート',
        ...(request.requiredPoints.length ? [`必須地点 ${request.requiredPoints.map((point) => point.label).join('、')} を通過`] : []),
        `高低差 ${suitability.elevationRangeM}m · 累積上り ${suitability.totalAscentM}m`,
        `最高標高 ${suitability.highPointM}m · 平均標高 ${suitability.averageElevationM}m`,
        `最大勾配 ${suitability.maxGradePct}% · カーブ密度 ${suitability.curveDensity.toFixed(1)} 回/km`,
        `人通りの少なさ推定 ${suitability.quietnessScore.toFixed(1)} / 5`,
      ],
      validation: { ...validation, elevationRangeM: suitability.elevationRangeM, elevationSource: elevation.source },
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
  return chainRoadWays(ways).flatMap((chain) => splitRoadCorridor(chain.route, request.maxDistanceKm).map((route) => ({ ...chain, route }))).map((chain) => {
    const { tags, route } = chain
    const validation = validateDiscoveredRoad(route)
    const width = highwayWidthScore(tags)
    const housingRisk = residentialRisk(tags)
    const styleScore = request.style === 'winding'
      ? validation.curveDensity * 7 + width * .25
      : request.style === 'easy'
        ? width * 1.6 - validation.curveDensity * .35
        : validation.curveDensity * 4 + width
    return { chain, tags, route, validation, width, housingRisk, score: styleScore - housingRisk * 1.8 }
  })
    .filter((item) => item.validation.warnings.every((warning) => warning === '候補区間が短すぎます'))
    .filter((item) => item.validation.roadLengthKm >= Math.max(1.1, Math.min(4, request.maxDistanceKm * .58)))
    .filter((item) => item.validation.roadLengthKm <= request.maxDistanceKm)
    .filter((item) => request.toll === 'all' || tollFromTags(item.tags) === request.toll)
    .sort((a, b) => b.score - a.score)
    // Retain several sections of a long named pass: one may be flat while a
    // different 4–6km section is exactly the compact climb being requested.
    .slice(0, 16)
}

async function fetchOverpass(query: string): Promise<OverpassResult> {
  const data = encodeURIComponent(query)
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), CLIENT_REQUEST_TIMEOUT_MS)
  try {
    // Never fall back to a browser-to-Overpass request in production. Public
    // mirrors generally reject that with CORS, which both fails discovery and
    // pollutes the console. The Netlify relay owns mirror retries instead.
    // Production uses POST so a long Overpass query does not exceed proxy/CDN
    // URL limits or flood the browser console. The Vite relay intentionally
    // keeps GET support for local development without a request-body parser.
    const response = import.meta.env.DEV
      ? await fetch(`${ROAD_DISCOVERY_RELAY}?data=${data}`, { method: 'GET', signal: controller.signal, cache: 'no-store' })
      : await fetch(ROAD_DISCOVERY_RELAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: controller.signal, cache: 'no-store' })
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { error?: unknown } | null
      const detail = typeof failure?.error === 'string' ? failure.error : `道路データ取得エラー (${response.status})`
      if (response.status >= 500 || response.status === 429) throw new RoadDiscoveryUnavailableError(detail)
      throw new Error(detail)
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('道路データの応答形式が不正です')
    const result = await response.json() as OverpassResult
    if (!Array.isArray(result.elements)) throw new Error('道路データの応答形式が不正です')
    return result
  } catch (error) {
    if (controller.signal.aborted) throw new RoadDiscoveryUnavailableError('道路データの取得が時間切れになりました。少し待って再試行してください')
    throw error
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
    const enriched = await Promise.all(raw.slice(0, Math.max(count * 4, 12)).map(async (item) => {
    const elevation = await fetchElevationProfile(sampled(item.route, 30))
    // A synthetic profile is fine for a visual fallback elsewhere in the app,
    // but it is not reliable enough to label an unknown road a "峠".
    const suitability = assessTougeSuitability(item.route, elevation.values, item.tags, {}, request.maxDistanceKm)
    if (!suitability.eligible) return null
    const mountainBonus = suitability.elevationRangeM / 130 + suitability.totalAscentM / 260
      + suitability.highPointM / 420 + suitability.averageElevationM / 650
    const score = item.score + mountainBonus + suitability.quietnessScore * 1.15
    const name = item.tags.name || item.tags.ref || `${Math.round(request.radiusKm)}km圏の峠道`
    const tollStatus = tollFromTags(item.tags)
    return {
      id: `osm-${item.chain.wayIds.join('-')}`,
      source: 'openstreetmap' as const,
      name,
      area: item.tags.ref ? `${item.tags.ref} · 山間道路候補` : 'OpenStreetMap山間道路候補',
      // Keep the complete OSM geometry for preview rendering. The compact
      // waypoint list is only for the editor and must never replace the line.
      route: item.route,
      waypoints: proposalWaypoints(item.route),
      elevationProfile: elevation.values,
      elevationSource: elevation.source,
      labels: [name, `標高差 ${suitability.elevationRangeM}m`, `最大勾配 ${suitability.maxGradePct}%`],
      tollStatus,
      distanceKm: item.validation.roadLengthKm,
      score,
      reasons: [
        '峠適格判定を通過した山間道路',
        `高低差 ${suitability.elevationRangeM}m · 累積上り ${suitability.totalAscentM}m`,
        `最高標高 ${suitability.highPointM}m · 平均標高 ${suitability.averageElevationM}m`,
        `最大勾配 ${suitability.maxGradePct}% · カーブ密度 ${suitability.curveDensity.toFixed(1)} 回/km`,
        `推定道幅スコア ${item.width.toFixed(1)} / 5`,
        `人通りの少なさ推定 ${suitability.quietnessScore.toFixed(1)} / 5`,
        item.housingRisk <= 1 ? '生活道路・市街地要素が少ない区間を優先' : '市街地要素を減点して選定',
      ],
      validation: { ...item.validation, elevationRangeM: suitability.elevationRangeM, elevationSource: elevation.source },
    } satisfies DriveProposal
    }))
    const next = enriched.flatMap((item): DriveProposal[] => item ? [item] : []).sort((a, b) => b.score - a.score).slice(0, count)
    if (!next.length) throw new Error('この範囲に峠として提案できる道路が見つかりませんでした')
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
  if (request.requiredPoints.length || request.startPoint || request.goalPoint) return fromRoutedRoads()
  // Use the dependable public road router first. It is still constrained by
  // the strict pass gate above, so ordinary city routes cannot become a
  // suggestion. This also avoids surfacing a transient Overpass 5xx error in
  // the normal proposal flow.
  if (request.toll === 'all') {
    try { return await fromRoutedRoads() }
    catch (routingError) {
      try { return await fromOverpass() }
      catch (overpassError) {
        if (overpassError instanceof RoadDiscoveryUnavailableError) throw overpassError
        const routingMessage = routingError instanceof Error ? routingError.message : '条件に合う道路が見つかりませんでした'
        const overpassMessage = overpassError instanceof Error ? overpassError.message : '道路データを取得できませんでした'
        throw new Error(`${routingMessage}。道路属性の照合でも${overpassMessage}`)
      }
    }
  }
  return fromOverpass()
}
