import { useState, type FormEvent } from 'react'
import { useMobileSheet } from '../hooks/useMobileSheet'

export interface TollReport {
  fee: string
  freeCondition: string
  applicableTime: string
  sourceUrl: string
  observedAt: string
}

export function TollReportForm({ courseName, onCancel, onSave }: { courseName: string; onCancel: () => void; onSave: (report: TollReport) => Promise<void> }) {
  const sheet = useMobileSheet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      await onSave({ fee: String(data.get('fee')), freeCondition: String(data.get('freeCondition')), applicableTime: String(data.get('applicableTime')), sourceUrl: String(data.get('sourceUrl')), observedAt: String(data.get('observedAt')) })
      onCancel()
    } catch { setError('送信できませんでした。ログインと通信状態を確認してください。') } finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><form className={`modal ${sheet.className}`} style={sheet.style} onSubmit={submit} aria-labelledby="toll-report-title" {...sheet.dragProps} data-sheet-scroll {...sheet.scrollProps}>
    <div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">TOLL INFORMATION</p><h2 id="toll-report-title">{courseName}の料金情報を報告</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
    <p className="description">無料開放、時間帯、キャンペーン、料金変更などを情報源と一緒に投稿してください。確認後に公開情報へ反映します。</p></div>
    <div className="form-grid">
      <label>確認日<input required type="date" name="observedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>確認した料金<input name="fee" placeholder="例: 普通車 900円" /></label>
      <label className="wide">無料になる条件<textarea name="freeCondition" rows={2} placeholder="例: ○時以降、災害時の代替路、期間限定キャンペーン" /></label>
      <label className="wide">適用時間・期間<input name="applicableTime" placeholder="例: 2026年8月13日 18:00〜22:00" /></label>
      <label className="wide">情報源URL<input required type="url" name="sourceUrl" placeholder="道路管理者や自治体の案内URL" /></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '送信中…' : '情報を送信'}</button></footer>
  </form></div>
}
