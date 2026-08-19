import type { Coordinate } from '../types'

export type TerrainSample = { coordinate: Coordinate; elevation: number }
export type TerrainGrid = { rows: TerrainSample[][]; source: 'AWS Terrain Tiles' }

const TILE_SIZE = 256
const terrainCache = new Map<string, TerrainGrid>()

export function decodeTerrariumElevation(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32768
}

function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom
}

function latToTileY(lat: number, zoom: number): number {
  const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom
}

function terrainBounds(route: Coordinate[]) {
  const lngs = route.map(([lng]) => lng); const lats = route.map(([, lat]) => lat)
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats)
  const centerLat = (minLat + maxLat) / 2
  const longitudeKm = Math.max(.2, (maxLng - minLng) * 111.32 * Math.cos(centerLat * Math.PI / 180))
  const latitudeKm = Math.max(.2, (maxLat - minLat) * 111.32)
  // Give narrow ridge roads enough surrounding landscape without allowing a
  // long course to request an excessively wide rectangle of DEM tiles.
  const paddingKm = Math.min(7, Math.max(1.2, Math.max(longitudeKm, latitudeKm) * .16))
  const lngPadding = paddingKm / Math.max(1, 111.32 * Math.cos(centerLat * Math.PI / 180))
  const latPadding = paddingKm / 111.32
  return { minLng: minLng - lngPadding, maxLng: maxLng + lngPadding, minLat: minLat - latPadding, maxLat: maxLat + latPadding, spanKm: Math.max(longitudeKm, latitudeKm) + paddingKm * 2 }
}

async function readTile(zoom: number, x: number, y: number, signal?: AbortSignal): Promise<ImageData> {
  const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, { signal })
  if (!response.ok) throw new Error(`DEM tile ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TILE_SIZE; canvas.height = TILE_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('DEM canvas unavailable')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
  } finally { bitmap.close() }
}

export async function fetchTerrainGrid(route: Coordinate[], columns: number, rowCount: number, signal?: AbortSignal): Promise<TerrainGrid> {
  if (route.length < 2) throw new Error('Route is too short for terrain')
  const bounds = terrainBounds(route)
  const zoom = bounds.spanKm > 48 ? 10 : bounds.spanKm > 24 ? 11 : bounds.spanKm > 11 ? 12 : 13
  const cacheKey = `${zoom}:${columns}:${rowCount}:${bounds.minLng.toFixed(4)}:${bounds.minLat.toFixed(4)}:${bounds.maxLng.toFixed(4)}:${bounds.maxLat.toFixed(4)}`
  const cached = terrainCache.get(cacheKey)
  if (cached) return cached

  const samples = Array.from({ length: rowCount + 1 }, (_, row) => Array.from({ length: columns + 1 }, (_, column) => {
    const lng = bounds.minLng + (bounds.maxLng - bounds.minLng) * column / columns
    const lat = bounds.minLat + (bounds.maxLat - bounds.minLat) * row / rowCount
    const tileX = lngToTileX(lng, zoom); const tileY = latToTileY(lat, zoom)
    return { coordinate: [lng, lat] as Coordinate, tileX, tileY, x: Math.floor(tileX), y: Math.floor(tileY) }
  }))
  const tileKeys = new Set(samples.flat().map(({ x, y }) => `${x}/${y}`))
  const tiles = new Map<string, ImageData>()
  await Promise.all([...tileKeys].map(async (key) => {
    const [x, y] = key.split('/').map(Number)
    tiles.set(key, await readTile(zoom, x, y, signal))
  }))
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const grid: TerrainGrid = {
    source: 'AWS Terrain Tiles',
    rows: samples.map((row) => row.map((sample) => {
      const image = tiles.get(`${sample.x}/${sample.y}`)
      if (!image) throw new Error('DEM tile missing')
      const pixelX = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((sample.tileX - sample.x) * TILE_SIZE)))
      const pixelY = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor((sample.tileY - sample.y) * TILE_SIZE)))
      const offset = (pixelY * TILE_SIZE + pixelX) * 4
      return { coordinate: sample.coordinate, elevation: decodeTerrariumElevation(image.data[offset], image.data[offset + 1], image.data[offset + 2]) }
    })),
  }
  terrainCache.set(cacheKey, grid)
  return grid
}
