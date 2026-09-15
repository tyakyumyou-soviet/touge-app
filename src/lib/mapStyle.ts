import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import type { ResolvedTheme } from './theme'

const darkPaint: Record<string, Record<string, unknown>> = {
  background: { 'background-color': '#101713' },
  landcover: { 'fill-color': ['match', ['get', 'class'], 'wood', '#173421', 'grass', '#1d3023', 'ice', '#29363b', '#18231d'] },
  landuse: { 'fill-color': ['match', ['get', 'class'], 'residential', '#292824', 'park', '#193221', 'hospital', '#332528', 'school', '#302d20', '#1d2821'] },
  water: { 'fill-color': '#16384a' }, waterway: { 'line-color': '#2a6682' }, boundary: { 'line-color': '#64736a' },
  'roads-casing': { 'line-color': '#0a0e0c' },
  roads: { 'line-color': ['match', ['get', 'class'], 'motorway', '#ad7244', 'trunk', '#a77a4c', 'primary', '#967c59', 'secondary', '#837a68', '#667068'] },
  buildings: { 'fill-color': '#303832', 'fill-outline-color': '#4a574f' },
  'road-labels': { 'text-color': '#c1cbc5', 'text-halo-color': '#111814' },
  'place-labels': { 'text-color': '#e4ece7', 'text-halo-color': '#111814' },
}

const overlayPaint = {
  light: {
    'terrain-hillshade': { 'hillshade-shadow-color': '#42574d', 'hillshade-highlight-color': '#f6f1dd', 'hillshade-accent-color': '#718477' },
    'courses-shadow': { 'line-color': '#101915' }, 'selected-glow': { 'line-color': '#101915' }, 'selected-contours': { 'line-color': '#637e70' },
    'draft-points': { 'circle-stroke-color': '#fff8e7' }, 'draft-point-labels': { 'text-color': '#142018' }, 'draft-point-names': { 'text-color': '#15251b', 'text-halo-color': '#fff8e7' },
    'pending-search-pin': { 'circle-stroke-color': '#fff8e7' }, 'pending-search-label': { 'text-color': '#7f2f27', 'text-halo-color': '#fff8e7' },
    'recommendation-points': { 'circle-stroke-color': '#fff8e7' }, 'recommendation-point-labels': { 'text-color': '#15251b', 'text-halo-color': '#fff8e7' },
    'current-location-dot': { 'circle-stroke-color': '#ffffff' }, 'selected-contour-labels': { 'text-color': '#516b5e', 'text-halo-color': '#f7f3e9' },
    'course-annotation-points': { 'circle-stroke-color': '#f6f1dd' }, 'course-annotation-labels': { 'text-color': '#203a2d', 'text-halo-color': '#f6f1dd' },
  },
  dark: {
    'terrain-hillshade': { 'hillshade-shadow-color': '#050806', 'hillshade-highlight-color': '#35433b', 'hillshade-accent-color': '#142019' },
    'courses-shadow': { 'line-color': '#050806' }, 'selected-glow': { 'line-color': '#050806' }, 'selected-contours': { 'line-color': '#7ea08f' },
    'draft-points': { 'circle-stroke-color': '#172019' }, 'draft-point-labels': { 'text-color': '#eef5f0' }, 'draft-point-names': { 'text-color': '#eef5f0', 'text-halo-color': '#172019' },
    'pending-search-pin': { 'circle-stroke-color': '#172019' }, 'pending-search-label': { 'text-color': '#ffb2a2', 'text-halo-color': '#172019' },
    'recommendation-points': { 'circle-stroke-color': '#172019' }, 'recommendation-point-labels': { 'text-color': '#eef5f0', 'text-halo-color': '#172019' },
    'current-location-dot': { 'circle-stroke-color': '#eef6f2' }, 'selected-contour-labels': { 'text-color': '#9fc4b1', 'text-halo-color': '#111814' },
    'course-annotation-points': { 'circle-stroke-color': '#172019' }, 'course-annotation-labels': { 'text-color': '#e4ece7', 'text-halo-color': '#111814' },
  },
} as const

/**
 * A compact OpenFreeMap style owned by the app. The upstream Liberty style
 * contains numeric filters such as `rank >= 3`; some vector features carry a
 * null rank and MapLibre logs a worker exception before map error handlers can
 * consume it. Keeping the visual style local removes that unstable expression
 * while retaining roads, terrain context, buildings, and place labels.
 */
export function createTougeMapStyle(theme: ResolvedTheme = 'light'): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#edf0e3' } },
      {
        id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        paint: {
          'fill-color': ['match', ['get', 'class'], 'wood', '#cfe0bd', 'grass', '#dce8c7', 'ice', '#edf4f2', '#e5ead5'],
          'fill-opacity': .72,
        },
      },
      {
        id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        paint: {
          'fill-color': ['match', ['get', 'class'], 'residential', '#e9e3dc', 'park', '#d3e4c7', 'hospital', '#f0dddd', 'school', '#ece8c9', '#e7eadb'],
          'fill-opacity': .58,
        },
      },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#9dc9e8' } },
      { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': '#82b9dc', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, .5, 15, 2] } },
      { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': '#a5aa9c', 'line-width': 1, 'line-opacity': .55, 'line-dasharray': [3, 2] } },
      {
        id: 'roads-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#b8a98d', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 3.6, 16, 8.5], 'line-opacity': .72 },
      },
      {
        id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], 'motorway', '#efb66e', 'trunk', '#efbd79', 'primary', '#f2c98d', 'secondary', '#f4d8a2', '#faf4e8'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, .6, 12, 2.5, 16, 7],
          'line-opacity': .96,
        },
      },
      {
        id: 'buildings', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': '#d3c9bd', 'fill-outline-color': '#bdb1a4', 'fill-opacity': .78 },
      },
      {
        id: 'road-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 11,
        layout: {
          'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:ja'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 13],
          'text-max-angle': 30,
        },
        paint: { 'text-color': '#625a4f', 'text-halo-color': '#f7f3e9', 'text-halo-width': 1.5 },
      },
      {
        id: 'place-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 4,
        layout: {
          'text-field': ['coalesce', ['get', 'name:ja'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 13, 13, 16], 'text-max-width': 9,
        },
        paint: { 'text-color': '#25342c', 'text-halo-color': '#f7f3e9', 'text-halo-width': 1.8 },
      },
    ],
  }
  if (theme === 'dark') {
    style.layers.forEach((layer) => {
      const paint = darkPaint[layer.id]
      if (paint) Object.assign(layer.paint ??= {}, paint)
    })
  }
  return style
}

/** Recolors the loaded map without replacing sources or losing app overlays. */
export function applyTougeMapTheme(map: MapLibreMap, theme: ResolvedTheme) {
  const entries = theme === 'dark' ? { ...darkPaint, ...overlayPaint.dark } : overlayPaint.light
  Object.entries(entries).forEach(([layerId, paint]) => {
    if (!map.getLayer(layerId)) return
    Object.entries(paint).forEach(([property, value]) => map.setPaintProperty(layerId, property, value as never))
  })
  if (theme === 'light') {
    const lightStyle = createTougeMapStyle('light')
    lightStyle.layers.forEach((layer) => {
      if (!map.getLayer(layer.id) || !layer.paint) return
      Object.entries(layer.paint).forEach(([property, value]) => map.setPaintProperty(layer.id, property, value as never))
    })
  }
}
