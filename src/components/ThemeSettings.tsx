import type { ThemePreference } from '../types'
import type { ResolvedTheme } from '../lib/theme'

interface Props {
  value: ThemePreference
  resolvedTheme: ResolvedTheme
  onChange: (value: ThemePreference) => void
}

const options: Array<{ value: ThemePreference; icon: string; label: string; description: string }> = [
  { value: 'system', icon: '◐', label: '端末に合わせる', description: '端末の外観設定と自動で連動' },
  { value: 'light', icon: '☀', label: 'ライト', description: '明るく見通しのよい表示' },
  { value: 'dark', icon: '☾', label: 'ダーク', description: '夜間でも眩しさを抑えた表示' },
]

export function ThemeSettings({ value, resolvedTheme, onChange }: Props) {
  return <section className="theme-settings" aria-labelledby="theme-settings-title">
    <div className="settings-section-heading">
      <div><span className="settings-kicker">APPEARANCE</span><h3 id="theme-settings-title">外観モード</h3><p>UIと地図の配色をまとめて切り替えます。</p></div>
      <span className="settings-count">現在: {resolvedTheme === 'dark' ? 'ダーク' : 'ライト'}</span>
    </div>
    <div className="theme-options" role="radiogroup" aria-label="外観モード">
      {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>
        <span className="theme-option-icon" aria-hidden="true">{option.icon}</span>
        <strong>{option.label}</strong>
        <small>{option.description}</small>
        <span className="theme-option-check" aria-hidden="true">{value === option.value ? '✓' : ''}</span>
      </button>)}
    </div>
    {value === 'system' && <p className="theme-system-note">端末の設定変更にもリアルタイムで追従します。</p>}
  </section>
}
