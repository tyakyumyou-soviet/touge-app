import type { Course, PersonalizationProfile, PersonalizationWeights, RatingKey } from '../types'

export const defaultPersonalization: PersonalizationProfile = { curves: 3, elevation: 3, width: 3, scenery: 3, surface: 3, traffic: 3, access: 3 }

export function normalizePersonalization(values: Partial<PersonalizationProfile>): PersonalizationProfile {
  return Object.fromEntries((Object.keys(defaultPersonalization) as RatingKey[]).map((key) => [key, Math.min(5, Math.max(1, Number(values[key] ?? defaultPersonalization[key])))])) as unknown as PersonalizationProfile
}

export function normalizePersonalizationWeights(weights: PersonalizationWeights | undefined, preferences: Partial<PersonalizationProfile> = {}): Record<RatingKey, number> {
  const keys = Object.keys(defaultPersonalization) as RatingKey[]
  // Before weighted preferences existed, values away from the neutral midpoint
  // represented an intentional choice. Preserve up to three of those choices.
  if (!weights) {
    const legacy = keys.filter((key) => Number(preferences[key] ?? 3) !== 3).slice(0, 3)
    return Object.fromEntries(keys.map((key) => [key, legacy.includes(key) ? 1 : 0])) as Record<RatingKey, number>
  }
  return Object.fromEntries(keys.map((key) => [key, Math.min(2, Math.max(0, Number(weights[key] ?? 0)))])) as Record<RatingKey, number>
}

export function personalizedScore(course: Course, preferences: Partial<PersonalizationProfile>, weights?: PersonalizationWeights): number {
  const targets = normalizePersonalization(preferences)
  const keys = Object.keys(targets) as RatingKey[]
  const quality = keys.reduce((total, key) => total + course.ratings[key], 0) / keys.length
  const normalizedWeights = normalizePersonalizationWeights(weights, preferences)
  const active = keys.filter((key) => normalizedWeights[key] > 0)
  if (!active.length) return quality
  const totalWeight = active.reduce((total, key) => total + normalizedWeights[key], 0)
  const similarity = active.reduce((total, key) => total + (5 - Math.abs(course.ratings[key] - targets[key])) * normalizedWeights[key], 0) / totalWeight
  return similarity * .9 + quality * .1
}
