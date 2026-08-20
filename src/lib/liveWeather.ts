import type { Coordinate } from '../types'

export interface CurrentWeather {
  summary: string
  temperature: string
  updatedAt: string
  sourceName: string
  sourceUrl: string
}

const weatherLabels: Record<number, string> = {
  0: '晴れ', 1: 'おおむね晴れ', 2: '晴れ時々くもり', 3: 'くもり', 45: '霧', 48: '着氷性の霧',
  51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '着氷性霧雨', 57: '強い着氷性霧雨',
  61: '弱い雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '強い着氷性の雨',
  71: '弱い雪', 73: '雪', 75: '強い雪', 77: '霧雪', 80: 'にわか雨', 81: '強いにわか雨', 82: '激しいにわか雨',
  85: 'にわか雪', 86: '強いにわか雪', 95: '雷雨', 96: 'ひょうを伴う雷雨', 99: '強いひょうを伴う雷雨',
}

/** Fetches keyless current weather at a route midpoint. Only weather is read
 * directly in the client; road restrictions and traffic remain official/admin
 * sourced data so the app never guesses safety-critical conditions. */
export async function fetchCurrentWeather(point: Coordinate): Promise<CurrentWeather> {
  const params = new URLSearchParams({ latitude: point[1].toFixed(5), longitude: point[0].toFixed(5), current: 'temperature_2m,weather_code', timezone: 'Asia/Tokyo' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`天候情報を取得できませんでした (${response.status})`)
    const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number; time?: string } }
    const current = data.current
    const code = current?.weather_code
    if (!current || !Number.isFinite(code)) throw new Error('天候情報の形式が不正です')
    return { summary: weatherLabels[Number(code)] ?? '天候情報あり', temperature: Number.isFinite(current.temperature_2m) ? `${current.temperature_2m}℃` : '気温不明', updatedAt: current.time ?? new Date().toLocaleString('ja-JP'), sourceName: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/' }
  } finally { clearTimeout(timer) }
}
