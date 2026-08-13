export type Coordinate = [number, number]

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

export interface TollInfo {
  type: 'toll' | 'free'
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
  visibility: Course['visibility']
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
