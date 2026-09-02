import type { Coordinate, Course, TollStatus } from '../types'
import type { ElevationResult } from './elevation'
import { distanceToRouteKm } from './courseSearch'
import { courseTollStatus } from './toll'

export type DriveStyle = 'winding' | 'balanced' | 'easy'

export interface DriveProposalRequest {
  center: Coordinate
  radiusKm: number
  maxDistanceKm: number
  /** Number of results requested by the driver. Defaults to one for a focused first suggestion. */
  proposalCount?: number
  toll: 'all' | TollStatus
  style: DriveStyle
  requiredPoints: Array<{ coordinate: Coordinate; label: string }>
  /** Optional anchors. When set, the generated road route starts/ends here. */
  startPoint?: { coordinate: Coordinate; label: string } | null
  goalPoint?: { coordinate: Coordinate; label: string } | null
}

/** Only explicit finder inputs may constrain discovery; never inherit builder stops. */
export function buildDriveProposalRequest(settings: DriveProposalRequest): DriveProposalRequest {
  const copyPoint = (point: NonNullable<DriveProposalRequest['startPoint']>) => ({
    coordinate: [...point.coordinate] as Coordinate, label: point.label,
  })
  return {
    center: [...settings.center], radiusKm: settings.radiusKm, maxDistanceKm: settings.maxDistanceKm,
    proposalCount: settings.proposalCount, toll: settings.toll, style: settings.style,
    requiredPoints: settings.requiredPoints.map(copyPoint),
    startPoint: settings.startPoint ? copyPoint(settings.startPoint) : null,
    goalPoint: settings.goalPoint ? copyPoint(settings.goalPoint) : null,
  }
}

export function proposalCountFor(request: Pick<DriveProposalRequest, 'proposalCount'>): number {
  // Callers from the course builder always pass an explicit value (initially
  // one). Preserve the previous three-item API behaviour for older callers.
  return Math.min(5, Math.max(1, Math.floor(request.proposalCount ?? 3)))
}

export interface DriveProposal {
  id: string
  /** Existing catalog item when this is a catalogue recommendation. */
  sourceCourseId?: string
  source: 'catalog' | 'openstreetmap'
  name: string
  area: string
  /** Complete road geometry used by map and 3D previews. */
  route: Coordinate[]
  /** Sparse editable stops used only when the proposal enters the route builder. */
  waypoints?: Coordinate[]
  /** Actual sampled elevations for the preview and 3D model, never a visual placeholder. */
  elevationProfile: number[]
  elevationSource: ElevationResult['source']
  labels: string[]
  tollStatus: TollStatus
  distanceKm: number
  score: number
  reasons: string[]
  validation?: {
    checked: boolean
    roadLengthKm: number
    curveDensity: number
    maxGapKm: number
    elevationRangeM?: number
    elevationSource?: string
    warnings: string[]
  }
}

/**
 * Reverses a not-yet-saved recommendation as one coherent route.  The map
 * geometry, editable waypoints, labels and elevation samples must all have
 * the same direction; reversing only the navigation URL leaves previews and
 * the 3D profile inconsistent.
 */
export function reverseDriveProposal(proposal: DriveProposal): DriveProposal {
  return {
    ...proposal,
    route: [...proposal.route].reverse(),
    waypoints: proposal.waypoints ? [...proposal.waypoints].reverse() : undefined,
    labels: [...proposal.labels].reverse(),
    elevationProfile: [...proposal.elevationProfile].reverse(),
  }
}

const priorities: Record<DriveStyle, Array<keyof Course['ratings']>> = {
  winding: ['curves', 'elevation', 'scenery', 'width'],
  balanced: ['curves', 'scenery', 'width', 'elevation'],
  easy: ['width', 'surface', 'access', 'scenery'],
}

function sampledRoute(course: Course) {
  const count = Math.min(12, Math.max(3, Math.ceil(course.route.length / 18)))
  return Array.from({ length: count }, (_, index) => course.route[Math.round((index / (count - 1)) * (course.route.length - 1))])
}

export function generateDriveProposals(courses: Course[], request: DriveProposalRequest): DriveProposal[] {
  const keys = priorities[request.style]
  return courses
    .filter((course) => course.route.length >= 2)
    .filter((course) => request.toll === 'all' || courseTollStatus(course) === request.toll)
    .filter((course) => distanceToRouteKm(request.center, course.route) <= request.radiusKm)
    .filter((course) => course.distanceKm <= request.maxDistanceKm)
    .filter((course) => request.requiredPoints.every((point) => distanceToRouteKm(point.coordinate, course.route) <= Math.max(3, request.radiusKm * .22)))
    .map((course) => {
      const score = keys.reduce((sum, key, index) => sum + course.ratings[key] * (keys.length - index), 0)
      const reasons = [
        `${request.style === 'winding' ? 'カーブ' : request.style === 'easy' ? '走りやすさ' : 'バランス'}を重視`,
        `高低差 ${Math.max(0, course.maxElevation - course.minElevation)}m`,
        courseTollStatus(course) === 'free' ? '無料道路' : courseTollStatus(course) === 'toll' ? '有料道路を含む' : courseTollStatus(course) === 'conditional' ? '条件付き無料情報あり' : '料金情報を確認',
      ]
      return {
        id: `${request.style}-${course.id}`,
        sourceCourseId: course.id,
        source: 'catalog' as const,
        name: course.name,
        area: course.area,
        route: course.route,
        waypoints: sampledRoute(course),
        elevationProfile: course.elevationProfile,
        elevationSource: course.elevationSource ?? '地形傾向による推定',
        labels: [course.area.split('〜')[0] || course.name, ...(course.landmarks?.slice(0, 3).map((item) => item.name) ?? []), course.area.split('〜').at(-1) || course.name],
        tollStatus: courseTollStatus(course),
        distanceKm: course.distanceKm,
        score,
        reasons,
      }
    })
    .sort((left, right) => right.score - left.score || left.distanceKm - right.distanceKm)
    .slice(0, proposalCountFor(request))
}
