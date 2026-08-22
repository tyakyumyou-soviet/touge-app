import type { Course, PersonalizationProfile, RatingKey } from '../types'

export const defaultPersonalization: PersonalizationProfile = { curves: 3, elevation: 3, width: 3, scenery: 3, surface: 3, traffic: 3, access: 3 }

export function normalizePersonalization(values: Partial<PersonalizationProfile>): PersonalizationProfile {
  return Object.fromEntries((Object.keys(defaultPersonalization) as RatingKey[]).map((key) => [key, Math.min(5, Math.max(1, Number(values[key] ?? defaultPersonalization[key])))])) as unknown as PersonalizationProfile
}

export function personalizedScore(course: Course, preferences: Partial<PersonalizationProfile>): number {
  const targets = normalizePersonalization(preferences)
  const keys = Object.keys(targets) as RatingKey[]
  const similarity = keys.reduce((total, key) => total + (5 - Math.abs(course.ratings[key] - targets[key])), 0) / keys.length
  const quality = keys.reduce((total, key) => total + course.ratings[key], 0) / keys.length
  return similarity * .9 + quality * .1
}
