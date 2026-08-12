import { writeFile } from 'node:fs/promises'

const endpoint = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'

const definitions = [
  {
    key: 'hakoneRoute', label: 'アネスト岩田ターンパイク箱根',
    selector: 'way["ref"="D18a"]["highway"~"^(tertiary|motorway_link)$"]',
    bbox: '35.15,138.95,35.30,139.20', expectedRef: 'D18a', expectedKm: [11, 16],
  },
  {
    key: 'ashinokoRoute', label: '芦ノ湖スカイライン本線',
    selector: 'way["name"="芦ノ湖スカイライン"]["ref"="D11"]["highway"="motorway"]',
    bbox: '35.15,138.94,35.30,139.05', expectedName: '芦ノ湖スカイライン', expectedRef: 'D11', expectedKm: [8, 12],
  },
  {
    key: 'izuRoute', label: '伊豆スカイライン',
    selector: 'way["ref"="D10"]["highway"~"^(secondary|secondary_link)$"]',
    bbox: '34.85,138.90,35.15,139.10', expectedName: '伊豆スカイライン', allowUnnamed: true, expectedRef: 'D10', expectedKm: [38, 44],
  },
  {
    key: 'okutamaRoute', label: '奥多摩周遊道路（川野〜都民の森区間）',
    selector: 'way["name"="川野上川乗線"]["ref"="206"]["highway"="secondary"]',
    bbox: '35.60,138.90,35.85,139.20', expectedName: '川野上川乗線', expectedRef: '206', expectedKm: [15, 17],
    clip: {
      start: [138.9983978, 35.7728778], // 三頭橋（川野側）
      end: [139.0309216, 35.7374373], // 東京都檜原都民の森
      maxEndpointDistanceKm: 0.15,
    },
  },
]

const keyOf = (point) => `${point[0].toFixed(7)},${point[1].toFixed(7)}`
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

function clipToEndpoints(points, clip, label) {
  const nearestIndex = (target) => points.reduce(
    (best, point, index) => distance(point, target) < best.distance
      ? { index, distance: distance(point, target) }
      : best,
    { index: -1, distance: Infinity },
  )
  const start = nearestIndex(clip.start)
  const end = nearestIndex(clip.end)
  if (start.distance > clip.maxEndpointDistanceKm || end.distance > clip.maxEndpointDistanceKm) {
    throw new Error(`${label}: clipping endpoint is not on the verified road (${start.distance.toFixed(2)}km, ${end.distance.toFixed(2)}km)`)
  }
  const [first, last] = start.index < end.index ? [start.index, end.index] : [end.index, start.index]
  const clipped = points.slice(first, last + 1)
  return start.index < end.index ? clipped : clipped.reverse()
}

function buildMainPath(elements) {
  const adjacency = new Map()
  for (const element of elements) {
    const line = element.geometry?.map(({ lon, lat }) => [lon, lat])
    if (!line || line.length < 2) continue
    const start = keyOf(line[0]); const end = keyOf(line.at(-1))
    const edge = { start, end, line, weight: lineDistance(line), wayId: element.id }
    for (const [node, reverse] of [[start, false], [end, true]]) {
      if (!adjacency.has(node)) adjacency.set(node, [])
      adjacency.get(node).push({ edge, reverse })
    }
  }
  if (!adjacency.size) throw new Error('No matching road geometry')

  const visited = new Set(); const components = []
  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue
    const nodes = []; const queue = [node]; visited.add(node)
    while (queue.length) {
      const current = queue.pop(); nodes.push(current)
      for (const { edge } of adjacency.get(current)) {
        const next = edge.start === current ? edge.end : edge.start
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    components.push(nodes)
  }
  components.sort((a, b) => b.length - a.length)
  if (components.length > 1 && components[1].length > 2) throw new Error(`Named road is disconnected (${components.map((item) => item.length).join(', ')})`)
  const component = components[0]; const allowed = new Set(component)

  function farthest(source) {
    const distances = new Map([[source, 0]]); const previous = new Map(); const pending = new Set(component)
    while (pending.size) {
      let current; let best = Infinity
      for (const node of pending) { const value = distances.get(node) ?? Infinity; if (value < best) { best = value; current = node } }
      if (!current) break
      pending.delete(current)
      for (const item of adjacency.get(current)) {
        const next = item.edge.start === current ? item.edge.end : item.edge.start
        if (!allowed.has(next)) continue
        const value = best + item.edge.weight
        if (value < (distances.get(next) ?? Infinity)) { distances.set(next, value); previous.set(next, { node: current, edge: item.edge }) }
      }
    }
    const target = [...distances].sort((a, b) => b[1] - a[1])[0][0]
    return { target, previous }
  }

  const terminal = component.find((node) => adjacency.get(node).length === 1) ?? component[0]
  const start = farthest(terminal).target
  const { target: end, previous } = farthest(start)
  const steps = []; let cursor = end
  while (cursor !== start) {
    const step = previous.get(cursor)
    if (!step) throw new Error('Could not reconstruct named road')
    steps.push({ from: step.node, to: cursor, edge: step.edge }); cursor = step.node
  }
  steps.reverse()
  const points = []; const wayIds = []
  for (const step of steps) {
    const line = step.edge.start === step.from ? step.edge.line : [...step.edge.line].reverse()
    points.push(...(points.length ? line.slice(1) : line)); wayIds.push(step.edge.wayId)
  }
  return { points: simplify(points), wayIds }
}

async function fetchWays(definition) {
  const query = `[out:json][timeout:120];${definition.selector}(${definition.bbox});out tags geom;`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'touge-app-named-route-builder/2.0' } })
    if (response.ok) return (await response.json()).elements
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
  }
  throw new Error(`${definition.label}: Overpass request failed`)
}

const output = []; const audits = []
for (const definition of definitions) {
  const elements = await fetchWays(definition)
  if (!elements.length) throw new Error(`${definition.label}: no matching named ways`)
  for (const element of elements) {
    if (definition.expectedName && element.tags?.name !== definition.expectedName && !(definition.allowUnnamed && !element.tags?.name)) throw new Error(`${definition.label}: unexpected name ${element.tags?.name}`)
    if (element.tags?.ref !== definition.expectedRef) throw new Error(`${definition.label}: unexpected ref ${element.tags?.ref}`)
  }
  const built = buildMainPath(elements)
  const points = definition.clip ? clipToEndpoints(built.points, definition.clip, definition.label) : built.points
  const { wayIds } = built
  const km = lineDistance(points)
  if (km < definition.expectedKm[0] || km > definition.expectedKm[1]) throw new Error(`${definition.label}: ${km.toFixed(1)}km is outside expected range`)
  output.push(`export const ${definition.key}: Coordinate[] = ${JSON.stringify(points)}\n`)
  audits.push({ key: definition.key, label: definition.label, points: points.length, distanceKm: Number(km.toFixed(2)), wayIds, generatedAt: new Date().toISOString() })
  console.log(`${definition.label}: ${points.length} points, ${km.toFixed(1)} km, ${wayIds.length} verified ways`)
}

await writeFile(new URL('../src/data/routes.generated.ts', import.meta.url), `// Generated only from verified OpenStreetMap named-road ways. Do not edit manually.\nimport type { Coordinate } from '../types'\n\n${output.join('\n')}\nexport const routeAudits = ${JSON.stringify(audits, null, 2)} as const\n`)
