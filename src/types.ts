export type Coordinate = [number, number]

/** The intended role of a stop while building a route. */
export type DraftPointRole = 'start' | 'via' | 'goal'

/** A temporary point used only while finding a recommended drive route. */
export interface RecommendationPoint {
  coordinate: Coordinate
  label: string
}

/** Map-visible constraints for the route recommendation finder. */
export interface RecommendationMapState {
  active: boolean
  /** Search-area marker only; never a routing stop. */
  center?: RecommendationPoint | null
  start: RecommendationPoint | null
  goal: RecommendationPoint | null
  vias: RecommendationPoint[]
}

export interface RecommendationMapAction {
  id: number
  point: Coordinate
  action: 'start' | 'via' | 'goal' | 'remove'
  role?: 'start' | 'via' | 'goal'
  index?: number
}

/** A recognised landmark placed along a published route. progress is 0–1 from START. */
export interface RouteLandmark {
  name: string
  progress: number
  type?: 'ic' | 'place' | 'viewpoint'
}

/** The compact, user-editable structure used to recreate a saved route. */
export interface CourseEditorStop {
  coordinate: Coordinate
  label: string
  role: DraftPointRole
}

export type RatingKey =
  | 'curves'
  | 'elevation'
  | 'width'
  | 'scenery'
  | 'surface'
  | 'traffic'
  | 'access'

export type Ratings = Record<RatingKey, number>

/** A route may include paid, free, conditionally free, or unknown segments. */
export type TollStatus = 'free' | 'toll' | 'conditional' | 'mixed' | 'unknown'

export interface TollInfo {
  type: TollStatus
  standardFee?: string
  hours?: string
  freePassConditions: string[]
  notes?: string
  sourceName: string
  sourceUrl: string
  checkedAt: string
}

export interface Course {
  id: string
  name: string
  area: string
  /** One or more prefectures, joined by ・ when a course crosses borders. */
  prefecture: string
  description: string
  route: Coordinate[]
  /** Original user-added stops. Dense road geometry is kept separately in route. */
  editorStops?: CourseEditorStop[]
  landmarks?: RouteLandmark[]
  distanceKm: number
  durationMin: number
  minElevation: number
  maxElevation: number
  elevationProfile: number[]
  /** Origin of the stored profile. Estimated data is automatically refreshed
   * when a verified public elevation lookup succeeds. */
  elevationSource?: '国土地理院 標高API' | '地形傾向による推定'
  ratings: Ratings
  /** System score calculated from public road, terrain and facility data. */
  systemRatings?: Ratings
  /** Average of actual user submissions, when available. */
  userRatings?: Ratings
  ratingCount: number
  systemRatingSource?: string[]
  systemRatingUpdatedAt?: string
  tags: string[]
  cautions: string[]
  /** Course-level summary used by search, recommendations, and map/list badges. */
  tollStatus?: TollStatus
  tollInfo?: TollInfo
  visibility: 'public' | 'limited' | 'private'
  /** Explicit recipients for limited sharing. Kept server-readable for rules. */
  allowedViewerIds?: string[]
  /** Global profile blocks are stored separately so unblocking does not erase
   * an intentional per-course block. */
  globalBlockedViewerIds?: string[]
  blockedViewerIds?: string[]
  authorId: string
  authorName: string
  updatedAt: string
  isSeed?: boolean
}

export interface CourseDraft {
  name: string
  area: string
  prefecture: Course['prefecture']
  description: string
  route: Coordinate[]
  editorStops?: CourseEditorStop[]
  tags: string[]
  cautions: string[]
  tollStatus: TollStatus
  visibility: Course['visibility']
  allowedViewerIds?: string[]
  blockedViewerIds?: string[]
}

export interface UserProfile {
  id: string
  displayName: string
  bio: string
  photoURL?: string | null
  homeArea?: string
  mapVisibility: 'all' | 'friends' | 'none'
  followingIds: string[]
  followerCount: number
  /** Optional car information and social profile/showcase links. */
  vehicleName?: string
  vehicleDetails?: string
  socialLinks?: Partial<Record<'x' | 'instagram' | 'youtube' | 'tiktok', string>>
  showcasePostUrls?: string[]
  friendLists?: FriendList[]
  blockedUserIds?: string[]
  /** Controls which route lines are rendered on this driver's map. */
  mapRouteVisibility?: 'all' | 'friends' | 'mine' | 'none'
  hiddenRouteIds?: string[]
  searchPresets?: SearchPreset[]
  personalization?: PersonalizationProfile
  locationSharing?: LocationSharingSettings
  nowPlaying?: NowPlaying
  updatedAt?: string
}

export interface FriendList { id: string; name: string; memberIds: string[] }
export interface SearchPreset { id: string; name: string; prefecture: string; toll: 'all' | TollStatus; radiusKm: number; sort: 'recommended' | 'curves' | 'elevation' | 'width' | 'personalized' }
export interface PersonalizationProfile { curves: number; elevation: number; width: number; scenery: number; surface: number; traffic: number; access: number }
export interface LocationSharingSettings { enabled: boolean; audience: 'friends' | 'lists'; listIds: string[] }
export interface NowPlaying { title: string; artist?: string; updatedAt: string }
export interface FriendPresence { userId: string; displayName: string; photoURL?: string | null; location?: Coordinate | null; allowedViewerIds?: string[]; updatedAt?: string; nowPlaying?: NowPlaying }

export interface CourseComment {
  id: string
  courseId: string
  authorId: string
  authorName: string
  body: string
  createdAt?: string
  likeCount: number
}

export interface LiveRoadInfo {
  weather: string
  temperature?: string
  restriction: string
  traffic: string
  sourceName: string
  sourceUrl?: string
  updatedAt: string
  status: 'good' | 'caution' | 'closed'
}

export interface AdminReport {
  id: string
  courseId: string
  type: 'toll-info' | 'road-condition' | 'discovery' | 'quality' | 'road'
  status: 'pending' | 'approved' | 'rejected'
  authorId: string
  authorName?: string
  sourceUrl: string
  observedAt?: string
  comment?: string
  createdAt?: string
}

export interface RatingSubmission extends Ratings {
  courseId: string
  comment?: string
}

export const ratingLabels: Record<RatingKey, string> = {
  curves: 'カーブ',
  elevation: '高低差',
  width: '道幅',
  scenery: '景色',
  surface: '路面',
  traffic: '交通量',
  access: 'アクセス',
}
