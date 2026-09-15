import { describe, expect, it } from 'vitest'
import { normalizeThemePreference, resolveThemePreference } from './theme'

describe('theme preferences', () => {
  it('accepts supported values and safely falls back to system', () => {
    expect(normalizeThemePreference('dark')).toBe('dark')
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('sepia')).toBe('system')
  })

  it('resolves system preference while keeping explicit choices', () => {
    expect(resolveThemePreference('system', true)).toBe('dark')
    expect(resolveThemePreference('system', false)).toBe('light')
    expect(resolveThemePreference('light', true)).toBe('light')
    expect(resolveThemePreference('dark', false)).toBe('dark')
  })
})
