import { describe, expect, it } from 'vitest'
import { createTougeMapStyle } from './mapStyle'

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
})
