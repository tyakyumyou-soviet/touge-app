import { describe, expect, it } from 'vitest'
import { bearingDifference, earlyAlertDistance, nearbySpeedAlert, speedCamerasFromOverpass } from './speedSafety'

describe('speed safety', () => {
  it('normalizes fixed camera nodes from Overpass', () => {
    const cameras = speedCamerasFromOverpass({ elements: [{ type: 'node', id: 42, lat: 35.4, lon: 139.2, tags: { highway: 'speed_camera', direction: '90', maxspeed: '50', name: 'テスト道路' } }] })
    expect(cameras).toEqual([expect.objectContaining({ id: 'osm-speed-camera-42', point: [139.2, 35.4], directionDegrees: 90, maxSpeedKph: 50 })])
  })

  it('only selects a close camera in the driving direction', () => {
    const camera = { id: 'camera', point: [139.004, 35] as [number, number], type: 'fixed' as const, directionDegrees: 90, sourceName: 'OpenStreetMap' as const, sourceUrl: '', lastVerifiedAt: '' }
    expect(nearbySpeedAlert([139, 35], 60, 90, 8, [camera])).toEqual(expect.objectContaining({ camera, stage: 'early' }))
    expect(nearbySpeedAlert([139, 35], 60, 270, 8, [camera])).toBeNull()
  })

  it('uses bounded time-based warning distances', () => {
    expect(earlyAlertDistance(0)).toBe(300)
    expect(earlyAlertDistance(200)).toBe(1200)
    expect(bearingDifference(5, 355)).toBe(10)
  })
})
