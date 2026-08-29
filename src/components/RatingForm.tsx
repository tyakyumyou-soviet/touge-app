import { useState, type FormEvent } from 'react'
import { emptyRatings } from '../lib/course'
import { ratingLabels, type RatingKey, type RatingSubmission } from '../types'
import { useMobileSheet } from '../hooks/useMobileSheet'

export function RatingForm({ courseId, courseName, onCancel, onSave }: { courseId: string; courseName: string; onCancel: () => void; onSave: (rating: RatingSubmission) => Promise<void> }) {
  const sheet = useMobileSheet()
  const [ratings, setRatings] = useState(emptyRatings())
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    const form = new FormData(event.currentTarget)
    try { await onSave({ courseId, ...ratings, comment: String(form.get('comment')) }); onCancel() } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop"><form className={`modal rating-form ${sheet.className}`} style={sheet.style} onSubmit={submit} aria-labelledby="rating-title" {...sheet.dragProps} data-sheet-scroll {...sheet.scrollProps}>
      <div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">DRIVE REVIEW</p><h2 id="rating-title">{courseName}を評価</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button></header>
      <p>実際に走行した印象を項目別に教えてください。</p></div>
      <div className="rating-inputs">{(Object.entries(ratingLabels) as [RatingKey, string][]).map(([key, label]) => <label key={key}><span>{label}</span><input type="range" min="1" max="5" step="1" value={ratings[key]} onChange={(event) => setRatings({ ...ratings, [key]: Number(event.target.value) })} /><b>{ratings[key]}</b></label>)}</div>
      <label>コメント（任意）<textarea name="comment" rows={3} /></label>
      <footer><button type="button" className="button secondary" onClick={onCancel}>キャンセル</button><button className="button primary" disabled={busy}>評価を投稿</button></footer>
    </form></div>
  )
}
