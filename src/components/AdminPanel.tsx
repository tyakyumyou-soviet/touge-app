import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { AdminReport, Course } from '../types'
import { loadPendingAdminReports, reviewAdminReport } from '../lib/firebase'
import { useMobileSheet } from '../hooks/useMobileSheet'

export function AdminPanel({ user, courses, onClose }: { user: User; courses: Course[]; onClose: () => void }) {
  const sheet = useMobileSheet(); const [reports, setReports] = useState<AdminReport[]>([]); const [notice, setNotice] = useState('')
  const refresh = () => loadPendingAdminReports().then(setReports).catch(() => setNotice('確認待ち情報を読み込めませんでした'))
  useEffect(() => { refresh() }, [])
  async function review(report: AdminReport, status: 'approved' | 'rejected') { try { await reviewAdminReport(report.id, status, user); setReports((items) => items.filter((item) => item.id !== report.id)); setNotice(status === 'approved' ? '承認しました。コース情報への反映は内容を編集して行ってください。' : '差し戻しました。') } catch { setNotice('更新できませんでした。Firestoreルールを確認してください。') } }
  return <div className="modal-backdrop"><section className={`modal admin-panel ${sheet.className}`} style={sheet.style} role="dialog" aria-modal="true" aria-labelledby="admin-title" {...sheet.dragProps}><div className="mobile-sheet-drag-region"><div className="mobile-sheet-handle" aria-hidden="true" /><header><div><p className="eyebrow">ADMIN REVIEW</p><h2 id="admin-title">情報承認・編集</h2></div><button className="icon-button" onClick={onClose} aria-label="閉じる">×</button></header><p>ユーザー報告を情報源URLと照合して承認・差し戻しできます。承認後は対象コースの編集画面で正式情報を更新してください。</p></div><div className="admin-report-list">{reports.length ? reports.map((report) => <article key={report.id}><strong>{courses.find((course) => course.id === report.courseId)?.name ?? report.courseId}</strong><span>{report.type} · {report.observedAt ?? report.createdAt ?? '日付不明'}</span>{report.comment && <p>{report.comment}</p>}<a href={report.sourceUrl} target="_blank" rel="noreferrer">情報源を開く ↗</a><footer><button className="button secondary" onClick={() => void review(report, 'rejected')}>差し戻し</button><button className="button primary" onClick={() => void review(report, 'approved')}>承認</button></footer></article>) : <p className="muted">確認待ちの情報はありません。</p>}</div>{notice && <p className="form-success" role="status">{notice}</p>}</section></div>
}
