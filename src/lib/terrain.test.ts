import { describe, expect, it } from 'vitest'
import { decodeTerrariumElevation } from './terrain'

describe('Terrarium elevation decoding', () => {
  it('decodes sea level', () => expect(decodeTerrariumElevation(128, 0, 0)).toBe(0))
  it('decodes positive and fractional elevations', () => expect(decodeTerrariumElevation(129, 244, 128)).toBe(500.5))
  it('decodes elevations below sea level', () => expect(decodeTerrariumElevation(127, 246, 0)).toBe(-10))
})
