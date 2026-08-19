import type { Coordinate, Course, CourseDraft } from '../types'

export type CourseDraftDefaults = Pick<CourseDraft, 'name' | 'area' | 'prefecture'>

const prefectures: Course['prefecture'][] = ['東京都', '神奈川県', '静岡県']

function locationName(label: string | undefined) {
  return (label ?? '')
    .trim()
    .replace(/^(東京都|神奈川県|静岡県)/, '')
    .replace(/〒?\d{3}-?\d{4}/g, '')
    .replace(/[0-9０-９]+(?:[-－ー][0-9０-９]+)*.*$/, '')
    .replace(/[、,，].*$/, '')
    .trim()
}

function prefectureFromRoute(route: Coordinate[]): Course['prefecture'] {
  const point = route[Math.floor(route.length / 2)]
  if (!point) return '静岡県'
  const [longitude, latitude] = point
  if (latitude >= 35.38) return '東京都'
  if (longitude >= 139 && latitude >= 35.02) return '神奈川県'
  return '静岡県'
}

/** Produces useful, editable defaults from the stops currently on the map. */
export function buildCourseDraftDefaults(labels: string[], route: Coordinate[]): CourseDraftDefaults {
  const meaningfulLabels = labels.filter((label) => label && label !== '地図指定')
  const source = meaningfulLabels.join(' ')
  const prefecture = prefectures.find((candidate) => source.includes(candidate)) ?? prefectureFromRoute(route)
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
