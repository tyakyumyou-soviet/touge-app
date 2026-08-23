import type { StyleSpecification } from 'maplibre-gl'

/**
 * A compact OpenFreeMap style owned by the app. The upstream Liberty style
 * contains numeric filters such as `rank >= 3`; some vector features carry a
 * null rank and MapLibre logs a worker exception before map error handlers can
 * consume it. Keeping the visual style local removes that unstable expression
 * while retaining roads, terrain context, buildings, and place labels.
 */
export function createTougeMapStyle(): StyleSpecification {
  return {
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
}
