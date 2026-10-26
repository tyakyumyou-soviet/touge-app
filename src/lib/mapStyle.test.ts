import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { applyTougeMapTheme, createTougeMapStyle } from './mapStyle'

describe('touge map style', () => {
  it('uses the OpenFreeMap vector source without nullable numeric feature filters', () => {
    const style = createTougeMapStyle()
    expect(style.sources.openmaptiles).toEqual({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    expect(style.layers.every((layer) => !('filter' in layer) || layer.filter === undefined)).toBe(true)
  })

  it('keeps the road and place context required by a route map', () => {
    const ids = createTougeMapStyle().layers.map((layer) => layer.id)
    expect(ids).toEqual(expect.arrayContaining(['landcover', 'water', 'roads', 'buildings', 'road-labels', 'place-labels']))
  })

  it('ships a genuinely dark map palette rather than only dark UI chrome', () => {
    const light = createTougeMapStyle('light')
    const dark = createTougeMapStyle('dark')
    const paint = (style: typeof light, id: string) => style.layers.find((layer) => layer.id === id)?.paint
    expect(paint(dark, 'background')).not.toEqual(paint(light, 'background'))
    expect(paint(dark, 'water')).not.toEqual(paint(light, 'water'))
    expect(paint(dark, 'roads')).not.toEqual(paint(light, 'roads'))
    expect(paint(dark, 'place-labels')).not.toEqual(paint(light, 'place-labels'))
  })

  it('recolors 3D route overlays in both directions when the theme changes', () => {
    const setPaintProperty = vi.fn()
    const map = { getLayer: () => ({}), setPaintProperty } as unknown as MapLibreMap
    applyTougeMapTheme(map, 'dark')
    expect(setPaintProperty).toHaveBeenCalledWith('course-contours', 'line-color', '#7ea08f')
    expect(setPaintProperty).toHaveBeenCalledWith('course-annotation-labels', 'text-color', '#e4ece7')
    setPaintProperty.mockClear()
    applyTougeMapTheme(map, 'light')
    expect(setPaintProperty).toHaveBeenCalledWith('course-contours', 'line-color', '#637e70')
    expect(setPaintProperty).toHaveBeenCalledWith('course-annotation-labels', 'text-color', '#203a2d')
  })
})
