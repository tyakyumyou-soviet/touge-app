/** All 47 prefectures. Course records may contain more than one, joined by ・. */
export const JAPANESE_PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
] as const

export type JapanesePrefecture = typeof JAPANESE_PREFECTURES[number]

export function prefecturesInText(value: string) {
  return JAPANESE_PREFECTURES.filter((prefecture) => value.includes(prefecture))
}

/**
 * Gives familiar regional names priority where the official number-plate
 * jurisdiction is unambiguous. Other prefectures gracefully use the returned
 * municipality name instead of inventing a plate region.
 */
export function numberPlateArea(prefecture: string, municipality: string) {
  const value = municipality.replace(/[都道府県]/g, '')
  if (prefecture === '静岡県') {
    if (/^(熱海|三島|伊東|下田|伊豆|伊豆の国|東伊豆|河津|南伊豆|松崎|西伊豆|函南)/.test(value)) return '伊豆'
    if (/^(沼津|清水|長泉)/.test(value)) return '沼津'
    if (/^(富士宮|富士|御殿場|裾野|小山)/.test(value)) return '富士山'
    if (/^(浜松|磐田|掛川|袋井|湖西|御前崎|菊川|森)/.test(value)) return '浜松'
    return '静岡'
  }
  if (prefecture === '神奈川県') {
    if (/^(平塚|藤沢|小田原|茅ヶ崎|秦野|伊勢原|南足柄|大井|松田|山北|開成|箱根|湯河原|真鶴)/.test(value)) return '湘南'
    if (/^(相模原|厚木|大和|海老名|座間|綾瀬|愛川|清川)/.test(value)) return '相模'
    if (/^川崎/.test(value)) return '川崎'
    return '横浜'
  }
  if (prefecture === '東京都') {
    if (/^(八王子|青梅|日野|福生|あきる野|羽村|奥多摩|檜原)/.test(value)) return '八王子'
    if (/^(三鷹|調布|府中|小金井|立川|昭島|町田|武蔵野|多摩|稲城)/.test(value)) return '多摩'
    return '東京'
  }
  return municipality || prefecture.replace(/[都府県]$/, '')
}
