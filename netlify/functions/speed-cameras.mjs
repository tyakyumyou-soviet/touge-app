const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const UPSTREAM_TIMEOUT_MS = 14_000

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Fixed-camera data changes slowly; caching also protects the shared
      // public Overpass service from repeated map pans.
      'cache-control': statusCode === 200 ? 'public, max-age=300, stale-while-revalidate=86400' : 'no-store',
    },
    body: JSON.stringify(body),
  }
}

function boundedBox(parameters) {
  const values = Object.fromEntries(['south', 'west', 'north', 'east'].map((key) => [key, Number(parameters?.[key])]))
  if (!Object.values(values).every(Number.isFinite)) return null
  const { south, west, north, east } = values
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null
  // A bounded area prevents this public relay from becoming an arbitrary
  // planet-scale Overpass proxy. The client requests roughly a 35 km radius.
  if (north - south > 1 || east - west > 1.5) return null
  return values
}

function queryFor({ south, west, north, east }) {
  return `[out:json][timeout:12];(node["highway"="speed_camera"](${south},${west},${north},${east});node["enforcement"="maxspeed"](${south},${west},${north},${east}););out body;`
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GETのみ対応しています' })
  const box = boundedBox(event.queryStringParameters)
  if (!box) return json(400, { error: '検索範囲が不正です' })
  const query = queryFor(box)
  const request = async (endpoint) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': 'Touge-App speed-safety/1.0' },
        body: new URLSearchParams({ data: query }), signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Overpass API ${response.status}`)
      const data = await response.json()
      if (!Array.isArray(data?.elements)) throw new Error('Overpass APIの応答形式が不正です')
      return data
    } finally { clearTimeout(timer) }
  }
  try {
    return json(200, await Promise.any(OVERPASS_ENDPOINTS.map(request)))
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [error]
    const last = errors.at(-1)
    return json(503, { error: last instanceof Error ? last.message : '速度注意情報を取得できませんでした' })
  }
}
