import { describe, expect, it } from 'vitest'
import { JAPANESE_PREFECTURES, numberPlateArea, prefecturesInText } from './administrativeAreas'

describe('administrative area helpers', () => {
  it('offers every prefecture for registration and filtering', () => {
    expect(JAPANESE_PREFECTURES).toHaveLength(47)
    expect(new Set(JAPANESE_PREFECTURES).size).toBe(47)
    expect(JAPANESE_PREFECTURES).toContain('北海道')
    expect(JAPANESE_PREFECTURES).toContain('沖縄県')
  })

  it('keeps every prefecture found in a border-crossing route label', () => {
    expect(prefecturesInText('静岡県から神奈川県を経由して東京都へ')).toEqual(['東京都', '神奈川県', '静岡県'])
  })

  it('uses familiar number-plate areas where their jurisdiction is clear', () => {
    expect(numberPlateArea('静岡県', '伊豆の国市')).toBe('伊豆')
    expect(numberPlateArea('神奈川県', '小田原市')).toBe('湘南')
    expect(numberPlateArea('東京都', '奥多摩町')).toBe('八王子')
    expect(numberPlateArea('長野県', '松本市')).toBe('松本市')
  })
})
