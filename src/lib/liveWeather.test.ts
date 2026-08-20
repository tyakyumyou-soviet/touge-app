import { describe, expect, it, vi } from 'vitest'
import { fetchCurrentWeather } from './liveWeather'

describe('current weather', () => {
  it('maps an external weather code to a Japanese condition', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: { temperature_2m: 22.4, weather_code: 61, time: '2026-08-20T10:00' } }) }))
    const weather = await fetchCurrentWeather([139, 35])
    expect(weather).toMatchObject({ summary: '弱い雨', temperature: '22.4℃', sourceName: 'Open-Meteo' })
    vi.unstubAllGlobals()
  })
})
