export type Coordinate = [number, number]

export type RatingKey =
  | 'curves'
  | 'elevation'
  | 'width'
  | 'scenery'
  | 'surface'
  | 'traffic'
  | 'access'

export type Ratings = Record<RatingKey, number>

export interface Course {
  id: string
  name: string
  area: string
  prefecture: '東京都' | '神奈川県' | '静岡県'
  description: string
  route: Coordinate[]
  distanceKm: number
  durationMin: number
  minElevation: number
  maxElevation: number
  elevationProfile: number[]
  ratings: Ratings
  ratingCount: number
  tags: string[]
  cautions: string[]
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
