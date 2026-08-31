import { describe, expect, it, vi } from 'vitest'
import { currentSearchLocation } from './currentLocation'
import { buildDriveProposalRequest } from './recommendations'

function position(longitude = 138.95, latitude = 35.04, accuracy = 20): GeolocationPosition {
  return { coords: { longitude, latitude, accuracy }, timestamp: 0 } as GeolocationPosition
}

describe('current location for area discovery', () => {
  it('allows a recent ordinary fix without requiring a high-accuracy GPS lock', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success(position()))
    const result = await currentSearchLocation({ getCurrentPosition })
    expect(result.coordinate).toEqual([138.95, 35.04])
    expect(getCurrentPosition.mock.calls[0]).toEqual([expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false, maximumAge: 30000, timeout: 8000,
    }])
  })

  it.each([2, 3])('retries transient location failure %i once', async (code) => {
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_success: PositionCallback, fail: PositionErrorCallback) => fail({ code } as GeolocationPositionError))
      .mockImplementationOnce((success: PositionCallback) => success(position()))
    expect((await currentSearchLocation({ getCurrentPosition })).coordinate).toEqual([138.95, 35.04])
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(getCurrentPosition.mock.calls[1][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 12000 })
  })

  it('never retries denied permission or substitutes a different location', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code: 1 } as GeolocationPositionError))
    await expect(currentSearchLocation({ getCurrentPosition })).rejects.toThrow('許可されていません')
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('explains a timeout after both attempts', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, fail?: PositionErrorCallback | null) => fail?.({ code: 3 } as GeolocationPositionError))
    await expect(currentSearchLocation({ getCurrentPosition })).rejects.toThrow('時間切れ')
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid coordinates and labels a coarse position explicitly', async () => {
    await expect(currentSearchLocation({ getCurrentPosition: (success) => success(position(NaN)) })).rejects.toThrow('座標')
    expect((await currentSearchLocation({ getCurrentPosition: (success) => success(position(138.95, 35.04, 650)) })).label).toContain('位置精度 約650m')
  })

  it('uses current location only as the search centre, not as an additional route stop', async () => {
    const location = await currentSearchLocation({ getCurrentPosition: (success) => success(position()) })
    const request = buildDriveProposalRequest({ center: location.coordinate, radiusKm: 25, maxDistanceKm: 4,
      style: 'balanced', toll: 'all', requiredPoints: [],
      ...{ route: [[139, 35], [140, 36]], pointRoles: ['start', 'goal'] },
    })
    expect(request.center).toEqual(location.coordinate)
    expect(request.requiredPoints).toEqual([])
    expect(request.startPoint).toBeNull()
    expect(request.goalPoint).toBeNull()
  })
})
