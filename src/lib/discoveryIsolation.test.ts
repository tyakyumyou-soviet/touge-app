import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coordinate } from '../types'
import { buildDriveProposalRequest, type DriveProposalRequest } from './recommendations'
import { discoverExternalDriveProposals, RoadDiscoveryUnavailableError } from './externalDiscovery'
import { fetchElevationProfile } from './elevation'

vi.mock('./elevation', () => ({ fetchElevationProfile: vi.fn() }))

const road: Coordinate[] = [
  [139, 35], [139.008, 35.008], [139.016, 35.004], [139.024, 35.012],
  [139.032, 35.008], [139.04, 35.016], [139.048, 35.012], [139.056, 35.02],
]
const settings: DriveProposalRequest = {
  center: [139.03, 35.01], radiusKm: 25, maxDistanceKm: 10,
  proposalCount: 1, toll: 'all', style: 'balanced', requiredPoints: [],
}
const response = () => Response.json({ code: 'Ok', routes: [{
  distance: 8000, duration: 720, geometry: { coordinates: road }, legs: [],
}] })

beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  vi.mocked(fetchElevationProfile).mockResolvedValue({ values: [100, 150, 210, 270, 350, 300, 230, 160], source: '国土地理院 標高API' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('finder inputs are independent of the route being composed', () => {
  it('does not inherit builder start, vias, goal or insertion order; results remain identical', async () => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    const empty = buildDriveProposalRequest(settings)
    const populated = buildDriveProposalRequest({ ...settings,
      // Deliberately pass extra runtime fields, as a future caller might do.
      ...{ route: [[130, 32], [131, 33], [132, 34]], pointRoles: ['start', 'via', 'goal'], viaInsertAfter: 1 },
    })
    expect(populated).toEqual(empty)
    const baseline = await discoverExternalDriveProposals(empty)
    expect(baseline).toHaveLength(1)
    expect(baseline[0].labels).toHaveLength(baseline[0].waypoints!.length)
    expect(baseline[0].labels).not.toContain('探索中心')
    const baselineUrls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]))
    fetchMock.mockClear()
    expect(await discoverExternalDriveProposals(populated)).toEqual(baseline)
    expect(fetchMock.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual(baselineUrls)
  })

  it('honours a requested result count when multiple valid routes are returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const proposals = await discoverExternalDriveProposals({ ...settings, proposalCount: 2 })
    expect(proposals).toHaveLength(2)
  })

  it('uses only explicit advanced start/via/goal in that order and snapshots the inputs', async () => {
    const via = { coordinate: [...road[3]] as Coordinate, label: '明示した経由地' }
    const request = buildDriveProposalRequest({ ...settings, requiredPoints: [via],
      startPoint: { coordinate: road[0], label: '始点' }, goalPoint: { coordinate: road[7], label: '終点' },
    })
    via.coordinate[0] = 130
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    expect(await discoverExternalDriveProposals(request)).toHaveLength(1)
    for (const call of fetchMock.mock.calls) {
      expect(String((call as unknown[])[0])).toContain('139.000000,35.000000;139.024000,35.012000;139.056000,35.020000')
    }
  })
})

describe('discovery failure reporting and load', () => {
  it('finds a surrounding pass when all immediate city-centre probes have no route', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls <= 8 ? Response.json({ code: 'NoRoute' }) : response()
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await discoverExternalDriveProposals(settings)).toHaveLength(1)
    expect(calls).toBe(16)
  })

  it('does not replace explicit start/via/goal with unconstrained surrounding probes', async () => {
    const fetchMock = vi.fn(async () => Response.json({ code: 'NoRoute' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverExternalDriveProposals({ ...settings, startPoint: { coordinate: road[0], label: '始点' } })).rejects.toThrow('条件に合う')
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it('reports a data outage rather than no matches even if the fallback returns zero ways', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/route/v1/')
      ? new Response('', { status: 503 }) : Response.json({ elements: [] })))
    await expect(discoverExternalDriveProposals(settings)).rejects.toBeInstanceOf(RoadDiscoveryUnavailableError)
  })

  it('distinguishes a successful no-route response from a service failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'NoRoute' })))
    const request = { ...settings, startPoint: { coordinate: road[0], label: '始点' } }
    await expect(discoverExternalDriveProposals(request)).rejects.toThrow('条件に合う道路が見つかりませんでした')
  })

  it('does not label estimated elevations as verified mountain candidates', async () => {
    vi.mocked(fetchElevationProfile).mockResolvedValue({ values: [100, 150, 350, 200], source: '地形傾向による推定' })
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    await expect(discoverExternalDriveProposals({ ...settings, startPoint: { coordinate: road[0], label: '始点' } })).rejects.toBeInstanceOf(RoadDiscoveryUnavailableError)
  })

  it('limits concurrent probes so elevation requests do not burst for all eight directions', async () => {
    let active = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      active += 1; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return response()
    }))
    expect(await discoverExternalDriveProposals(settings)).toHaveLength(1)
    expect(peak).toBeLessThanOrEqual(2)
  })
})
