import { describe, expect, it } from 'vitest'
import { normalizeAccountId, PRIMARY_SUPER_ADMIN_EMAIL, validAccountId } from './account'

describe('account identity', () => {
  it('normalizes full-width and upper-case account IDs before validation', () => {
    expect(normalizeAccountId('  ＴＯＵＧＥ_61  ')).toBe('touge_61')
    expect(validAccountId('  ＴＯＵＧＥ_61  ')).toBe(true)
  })

  it('accepts only stable 3-20 character IDs', () => {
    expect(validAccountId('ab')).toBe(false)
    expect(validAccountId('a'.repeat(21))).toBe(false)
    expect(validAccountId('_touge')).toBe(false)
    expect(validAccountId('峠driver')).toBe(false)
    expect(validAccountId('touge-driver_61')).toBe(true)
  })

  it('keeps the fixed primary super administrator explicit', () => {
    expect(PRIMARY_SUPER_ADMIN_EMAIL).toBe('taizu61zx@gmail.com')
  })
})
