import type { Course, PersonalizationProfile, RatingKey } from '../types'

export const defaultPersonalization: PersonalizationProfile = { curves: 3, elevation: 3, width: 3, scenery: 3, surface: 3, traffic: 3, access: 3 }

export function normalizePersonalization(values: Partial<PersonalizationProfile>): PersonalizationProfile {
  return Object.fromEntries((Object.keys(defaultPersonalization) as RatingKey[]).map((key) => [key, Math.min(5, Math.max(1, Number(values[key] ?? defaultPersonalization[key])))])) as unknown as PersonalizationProfile
}

export function personalizedScore(course: Course, preferences: Partial<PersonalizationProfile>): number {
  const weights = normalizePersonalization(preferences)
  const keys = Object.keys(weights) as RatingKey[]
  return keys.reduce((total, key) => total + course.ratings[key] * weights[key], 0) / keys.reduce((total, key) => total + weights[key], 0)
}
