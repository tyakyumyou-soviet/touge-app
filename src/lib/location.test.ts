import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRouteAdministrativeAreas } from './location'

afterEach(() => vi.unstubAllGlobals())

describe('route administrative area lookup', () => {
  it('collects all sampled prefectures and areas instead of only using the route midpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      const response = url.includes('lat=35.000000')
        ? { address: { state: '静岡県', city: '伊豆の国市' } }
        : url.includes('lat=35.100000')
          ? { address: { state: '神奈川県', city: '小田原市' } }
          : { address: { state: '東京都', town: '奥多摩町' } }
      return new Response(JSON.stringify(response), { status: 200 })
    }))

    await expect(resolveRouteAdministrativeAreas([
      [138.9, 35], [139, 35.1], [139.1, 35.2],
    ])).resolves.toEqual({ prefecture: '静岡県・神奈川県・東京都', area: '伊豆・湘南・八王子' })
  })
})
