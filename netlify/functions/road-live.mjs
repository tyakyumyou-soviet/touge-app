const UPSTREAM = 'https://api.jartic-open-traffic.org/geoserver'

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': statusCode === 200 ? 'public, max-age=300, stale-while-revalidate=900' : 'no-store' }, body: JSON.stringify(body) }
}

function validFilter(filter) {
  const match = filter.match(/^道路種別=3 AND 時間コード=(\d{12}) AND BBOX\(ジオメトリ,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),'EPSG:4326'\)$/)
  if (!match) return false
  const [, , west, south, east, north] = match.map(String)
  const values = [west, south, east, north].map(Number)
  return values.every(Number.isFinite) && values[0] >= 122 && values[2] <= 154 && values[1] >= 20 && values[3] <= 46 && values[0] < values[2] && values[1] < values[3] && values[2] - values[0] <= 2 && values[3] - values[1] <= 2
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GETのみ対応しています' })
  const query = event.queryStringParameters ?? {}
  if (query.typeNames !== 't_travospublic_measure_1h' || !validFilter(query.cql_filter ?? '')) return json(400, { error: '交通量クエリが不正です' })
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 't_travospublic_measure_1h', srsName: 'EPSG:4326',
    outputFormat: 'application/json', exceptions: 'application/json', cql_filter: query.cql_filter,
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${UPSTREAM}?${params}`, { signal: controller.signal, headers: { 'user-agent': 'Touge-App live traffic/1.0' } })
    if (!response.ok) return json(502, { error: `交通量API ${response.status}` })
    const data = await response.json()
    if (!Array.isArray(data?.features)) return json(502, { error: '交通量APIの応答形式が不正です' })
    return json(200, data)
  } catch (error) {
    return json(503, { error: error instanceof Error ? error.message : '交通量を取得できませんでした' })
  } finally { clearTimeout(timer) }
}
