import type { CourseDraft } from '../types'
import { JAPANESE_PREFECTURES, prefecturesInText } from './administrativeAreas'

export type CourseDraftDefaults = Pick<CourseDraft, 'name' | 'area' | 'prefecture'>

function locationName(label: string | undefined) {
  const value = (label ?? '').trim()
  const prefecture = JAPANESE_PREFECTURES.find((item) => value.startsWith(item))
  return value
    .trim()
    .replace(prefecture ?? '', '')
    .replace(/〒?\d{3}-?\d{4}/g, '')
    .replace(/[0-9０-９]+(?:[-－ー][0-9０-９]+)*.*$/, '')
    .replace(/[、,，].*$/, '')
    .trim()
}

/** Produces useful, editable defaults from the stops currently on the map. */
export function buildCourseDraftDefaults(labels: string[]): CourseDraftDefaults {
  const meaningfulLabels = labels.filter((label) => label && label !== '地図指定')
  const source = meaningfulLabels.join(' ')
  // The registration form replaces this fallback with live reverse-geocoded
  // administrative areas once it opens. Named stops still give an immediate,
  // useful value when offline.
  const prefecture = prefecturesInText(source).join('・') || '都道府県未判定'
  const start = locationName(meaningfulLabels[0])
  const goal = locationName(meaningfulLabels.at(-1))
  const area = start && goal && start !== goal ? `${start}〜${goal}` : start || goal || `${prefecture}周辺`

  return {
    name: `${area}ドライブ`,
    area,
    prefecture,
  }
}

/** Only #prefixed words are tags. Commas and both normal/full-width spaces split tokens. */
export function parseHashTags(input: string) {
  return [...new Set(input
    .split(/[,、，\s\u3000]+/)
    .filter((token) => token.startsWith('#'))
    .map((token) => token.replace(/^#+/, '').trim())
    .filter(Boolean))]
}
