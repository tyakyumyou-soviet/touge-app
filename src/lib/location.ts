import type { Coordinate } from '../types'
import { numberPlateArea, prefecturesInText } from './administrativeAreas'

export interface GeocodedPoint { coordinate: Coordinate; label: string; level?: number }

export interface RouteAdministrativeAreas {
  prefecture: string
  area: string
}

interface ReverseAddress { state?: string; province?: string; county?: string; city?: string; town?: string; village?: string; municipality?: string; city_district?: string; suburb?: string; display_name?: string }

function routeSamples(route: Coordinate[]) {
  if (!route.length) return []
  const count = Math.min(7, Math.max(2, route.length))
  return [...new Map(Array.from({ length: count }, (_, index) => {
    const point = route[Math.round(index * (route.length - 1) / Math.max(1, count - 1))]
    return [`${point[0].toFixed(4)},${point[1].toFixed(4)}`, point] as const
  })).values()]
}

/**
 * Looks up administrative names from the route itself.  Sampling the whole
 * line, rather than only its midpoint, preserves every prefecture/area when
 * a border-crossing course is registered.
 */
export async function resolveRouteAdministrativeAreas(route: Coordinate[]): Promise<RouteAdministrativeAreas | null> {
  const samples = routeSamples(route)
  if (!samples.length) return null
  const results = await Promise.allSettled(samples.map(async ([longitude, latitude]) => {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ja&zoom=10&lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json() as { address?: ReverseAddress; display_name?: string }
    const address = data.address ?? {}
    const text = [address.state, address.province, data.display_name, address.display_name].filter(Boolean).join(' ')
    const prefecture = prefecturesInText(text)[0]
    const municipality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.city_district ?? address.county ?? address.suburb ?? ''
    return prefecture ? { prefecture, area: numberPlateArea(prefecture, municipality) } : null
  }))
  const resolved = results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
  if (!resolved.length) return null
  const prefectures = [...new Set(resolved.map((item) => item.prefecture))]
  const areas = [...new Set(resolved.map((item) => item.area).filter(Boolean))]
  return { prefecture: prefectures.join('・'), area: areas.join('・') }
}

export async function geocodeJapanesePlace(query: string): Promise<GeocodedPoint> {
  const normalized = query.trim().replace(/[－ー−]/g, '-')
  const candidates = [...new Set([normalized, normalized.replace(/([0-9０-９]+)\s*-\s*([0-9０-９]+)/g, '$1番$2号')].filter(Boolean))]
  const looksLikeAddress = /[0-9０-９]/.test(normalized)
  if (looksLikeAddress) {
    try {
      for (const candidate of candidates) {
        const response = await fetch(`https://geocode.csis.u-tokyo.ac.jp/cgi-bin/simple_geocode.cgi?charset=UTF8&series=ADDRESS&addr=${encodeURIComponent(candidate)}`)
        if (!response.ok) continue
        const xml = new DOMParser().parseFromString(await response.text(), 'application/xml')
        const result = xml.querySelector('candidate')
        const longitude = Number(result?.querySelector('longitude')?.textContent)
        const latitude = Number(result?.querySelector('latitude')?.textContent)
        const level = Number(result?.querySelector('iLvl')?.textContent)
        if (Number.isFinite(longitude) && Number.isFinite(latitude) && level >= 6) return { coordinate: [longitude, latitude], label: result?.querySelector('address')?.textContent?.replaceAll('/', '') || candidate, level }
      }
    } catch { /* Continue with named places. */ }
    throw new Error(`「${query}」の番地レベルの位置を確認できませんでした。概算位置は追加していません。地図上で正確な場所を指定してください`)
  }
  try {
    for (const candidate of candidates) {
      const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(candidate)}`)
      if (!response.ok) continue
      const result = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] } }> }
      const coordinates = result.features?.[0]?.geometry?.coordinates
      if (coordinates && coordinates.every(Number.isFinite)) return { coordinate: coordinates, label: candidate }
    }
  } catch { /* Continue with Nominatim. */ }
  for (const candidate of candidates) {
    const placeQuery = /日本|東京都|神奈川県|静岡県/.test(candidate) ? candidate : `${candidate}, 日本`
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=jp&q=${encodeURIComponent(placeQuery)}`)
    if (!response.ok) continue
    const items = await response.json() as Array<{ lon: string; lat: string }>
    if (items[0]) return { coordinate: [Number(items[0].lon), Number(items[0].lat)], label: candidate }
  }
  throw new Error(`「${query}」が見つかりませんでした。地図上で正確な場所を指定してください`)
}
