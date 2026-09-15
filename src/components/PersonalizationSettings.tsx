import type { PersonalizationProfile, PersonalizationWeights, RatingKey, UserProfile } from '../types'
import { defaultPersonalization, normalizePersonalization, normalizePersonalizationWeights } from '../lib/personalization'

interface Props { profile: UserProfile; onChange: (values: Partial<UserProfile>) => void }

const traits: Array<{ key: RatingKey; label: string; icon: string; hint: string; choices?: Array<[number, string]> }> = [
  { key: 'curves', label: 'カーブ', icon: '〰', hint: '道の曲がり方', choices: [[1, '緩やか'], [3, 'バランス'], [5, 'タイト']] },
  { key: 'elevation', label: '高低差', icon: '⌁', hint: '上り下りの大きさ', choices: [[1, '平坦'], [3, 'ほどほど'], [5, '大きい']] },
  { key: 'width', label: '道幅', icon: '↔', hint: '走りたい道の広さ', choices: [[1, '狭め'], [3, '標準'], [5, '広め']] },
  { key: 'scenery', label: '景色', icon: '◒', hint: '景観を独立して重視' },
  { key: 'surface', label: '路面', icon: '▦', hint: '舗装の滑らかさ', choices: [[1, '荒れも歓迎'], [3, '標準'], [5, '滑らか']] },
  { key: 'traffic', label: '交通量', icon: '◇', hint: '空いている道を優先', choices: [[1, '賑やか'], [3, 'ほどほど'], [5, '少なめ']] },
  { key: 'access', label: 'アクセス', icon: '⌖', hint: '到達しやすさ', choices: [[1, '秘境寄り'], [3, 'ほどほど'], [5, '行きやすい']] },
]

const presets: Array<{ id: string; name: string; description: string; preferences: Partial<PersonalizationProfile>; keys: RatingKey[] }> = [
  { id: 'winding', name: 'ワインディング', description: 'カーブと起伏、空いた道', preferences: { curves: 5, elevation: 5, traffic: 5 }, keys: ['curves', 'elevation', 'traffic'] },
  { id: 'scenic', name: '景色ドライブ', description: '景色と高低差を楽しむ', preferences: { scenery: 5, elevation: 4, traffic: 4 }, keys: ['scenery', 'elevation', 'traffic'] },
  { id: 'comfort', name: '快適ツーリング', description: '広く滑らかで行きやすい', preferences: { width: 5, surface: 5, access: 5 }, keys: ['width', 'surface', 'access'] },
]

export function PersonalizationSettings({ profile, onChange }: Props) {
  const preferences = normalizePersonalization(profile.personalization ?? {})
  const weights = normalizePersonalizationWeights(profile.personalizationWeights, profile.personalization)
  const activeKeys = traits.map((trait) => trait.key).filter((key) => weights[key] > 0)

  function commit(nextPreferences: PersonalizationProfile, nextWeights: PersonalizationWeights) {
    onChange({ personalization: nextPreferences, personalizationWeights: nextWeights })
  }

  function toggleTrait(key: RatingKey) {
    const active = weights[key] > 0
    if (!active && activeKeys.length >= 3) return
    const nextWeights = { ...weights, [key]: active ? 0 : 2 }
    const nextPreferences = { ...preferences, [key]: active ? preferences[key] : 5 }
    commit(nextPreferences, nextWeights)
  }

  function applyPreset(keys: RatingKey[], values: Partial<PersonalizationProfile>) {
    const nextWeights = Object.fromEntries(traits.map((trait) => [trait.key, keys.includes(trait.key) ? 2 : 0])) as PersonalizationWeights
    commit({ ...defaultPersonalization, ...values }, nextWeights)
  }

  const summary = activeKeys.length ? activeKeys.map((key) => {
    const trait = traits.find((item) => item.key === key)!
    if (!trait.choices) return `${trait.label}を重視`
    return trait.choices.find(([value]) => value === preferences[key])?.[1] ?? trait.label
  }).join('・') : '指定なし。総合的な評価を使います'

  return <section className="personalization-settings personalization-modern">
    <header className="settings-section-heading"><div><span className="settings-kicker">FOR YOU</span><h3>好みの道路を見つける</h3><p>重視する特徴を最大3つ選ぶと、「パーソナライズ順」に反映されます。</p></div><span className="settings-count">{activeKeys.length}/3</span></header>
    <div className="personalization-summary"><span aria-hidden="true">✦</span><div><small>現在の好み</small><strong>{summary}</strong></div>{activeKeys.length > 0 && <button type="button" onClick={() => commit(defaultPersonalization, {})}>リセット</button>}</div>
    <div className="preference-presets" aria-label="好みのプリセット">{presets.map((preset) => <button type="button" key={preset.id} onClick={() => applyPreset(preset.keys, preset.preferences)}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}</div>
    <div className="preference-divider"><span>または特徴を選ぶ</span></div>
    <div className="preference-traits">{traits.map((trait) => {
      const active = weights[trait.key] > 0
      return <button type="button" key={trait.key} className={active ? 'active' : ''} aria-pressed={active} disabled={!active && activeKeys.length >= 3} onClick={() => toggleTrait(trait.key)}><span aria-hidden="true">{trait.icon}</span><strong>{trait.label}</strong><small>{trait.hint}</small><b aria-hidden="true">{active ? '✓' : '+'}</b></button>
    })}</div>
    {activeKeys.length > 0 && <div className="preference-tuning"><div><strong>好みを微調整</strong><small>必要な項目だけ選べます。</small></div>{activeKeys.map((key) => {
      const trait = traits.find((item) => item.key === key)!
      return trait.choices ? <fieldset key={key}><legend>{trait.label}</legend><div>{trait.choices.map(([value, label]) => <button type="button" key={value} className={preferences[key] === value ? 'selected' : ''} aria-pressed={preferences[key] === value} onClick={() => commit({ ...preferences, [key]: value }, weights)}>{label}</button>)}</div></fieldset> : <div className="preference-single" key={key}><span>{trait.icon}</span><div><strong>景色のよさを優先</strong><small>走りの特徴とは別に景観評価を反映します。</small></div><b>ON</b></div>
    })}</div>}
  </section>
}
