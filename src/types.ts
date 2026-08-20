export type Coordinate = [number, number]

/** The intended role of a stop while building a route. */
export type DraftPointRole = 'start' | 'via' | 'goal'

/** A recognised landmark placed along a published route. progress is 0–1 from START. */
export interface RouteLandmark {
  name: string
  progress: number
  type?: 'ic' | 'place' | 'viewpoint'
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
  prefecture: '東京都' | '神奈川県' | '静岡県'
  description: string
  route: Coordinate[]
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
  tags: string[]
  cautions: string[]
  tollStatus: TollStatus
  visibility: Course['visibility']
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
  updatedAt?: string
}

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
