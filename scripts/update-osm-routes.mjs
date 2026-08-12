import { writeFile } from 'node:fs/promises'

const routes = [
  {
    key: 'hakoneRoute',
    waypoints: [[139.1388, 35.2424], [139.1256, 35.233], [139.1109, 35.2143], [139.0502, 35.1852]],
  },
  {
    key: 'ashinokoRoute',
    waypoints: [[139.01401, 35.18205], [139.01353, 35.18281], [138.97878, 35.23045], [138.9787, 35.23091]],
  },
  {
    key: 'izuRoute',
    waypoints: [[139.037, 35.105], [139.041, 35.076], [139.0505, 35.043], [139.038, 35.005], [139.019, 34.965], [139.003, 34.924]],
  },
  {
    key: 'okutamaRoute',
    waypoints: [[138.9984, 35.7729], [139.034, 35.7665], [139.0421, 35.747], [139.0419, 35.7372]],
  },
]

const distance = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111.32
const lineDistance = (line) => line.slice(1).reduce((sum, point, index) => sum + distance(line[index], point), 0)

function simplify(points, tolerance = 0.000018) {
  if (points.length <= 2) return points
  const sqTolerance = tolerance * tolerance
  const sqSegmentDistance = (point, start, end) => {
    let x = start[0], y = start[1]
    let dx = end[0] - x, dy = end[1] - y
    if (dx || dy) {
      const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
      if (t > 1) { x = end[0]; y = end[1] }
      else if (t > 0) { x += dx * t; y += dy * t }
    }
    dx = point[0] - x; dy = point[1] - y
    return dx * dx + dy * dy
  }
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop(); let max = sqTolerance; let index = 0
    for (let i = first + 1; i < last; i++) {
      const value = sqSegmentDistance(points[i], points[first], points[last])
      if (value > max) { index = i; max = value }
    }
    if (index) { keep[index] = 1; stack.push([first, index], [index, last]) }
  }
  return points.filter((_, index) => keep[index])
}

async function fetchRoute(waypoints) {
  const coordinates = waypoints.map((point) => point.join(',')).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'touge-app-route-builder/1.0' } })
    if (response.ok) {
      const data = await response.json()
      if (data.code === 'Ok') return data.routes[0].geometry.coordinates
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
  }
  throw new Error('OSRM route generation failed')
}

const generated = []
for (const route of routes) {
  const points = simplify(await fetchRoute(route.waypoints))
  generated.push(`export const ${route.key}: Coordinate[] = ${JSON.stringify(points)}\n`)
  console.log(`${route.key}: ${points.length} points, ${lineDistance(points).toFixed(1)} km`)
}

await writeFile(new URL('../src/data/routes.generated.ts', import.meta.url), `// Generated from OpenStreetMap-based road routing. Do not edit manually.\nimport type { Coordinate } from '../types'\n\n${generated.join('\n')}`)
