import { useEffect, useRef } from 'react'
import { useMobileSheet } from '../hooks/useMobileSheet'

export function ProposalGoalDialog({ name, hasGoal, onChoose, onCancel }: { name: string; hasGoal: boolean; onChoose: (makeGoal: boolean) => void; onCancel: () => void }) {
  const sheet = useMobileSheet()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="modal-backdrop proposal-goal-backdrop"><section ref={dialog} tabIndex={-1} className={`modal proposal-goal-dialog ${sheet.className}`} style={sheet.style}
    role="dialog" aria-modal="true" aria-labelledby="proposal-goal-title" onKeyDown={(event) => {
      if (event.key === 'Escape') onCancel()
      if (event.key === 'Tab') {
        const buttons = Array.from(dialog.current?.querySelectorAll('button') ?? [])
        if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialog.current)) { event.preventDefault(); buttons.at(-1)?.focus() }
        if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus() }
      }
    }}>
    <div className="mobile-sheet-drag-region" {...sheet.dragProps}><div className="mobile-sheet-handle" aria-hidden="true" /><h2 id="proposal-goal-title">この区間の終点をゴールにしますか？</h2></div>
    <p>{name}</p>
    <div className="proposal-goal-choices">
      <button type="button" className="button secondary" onClick={() => onChoose(false)}>経由区間として追加<small>{hasGoal ? '今のゴールを維持します' : 'ゴールは後で指定できます'}</small></button>
      <button type="button" className="button primary" onClick={() => onChoose(true)}>終点をゴールにして追加<small>{hasGoal ? '今のゴールは経由地として残し、この区間を末尾に追加' : 'この区間を末尾に追加します'}</small></button>
      <button type="button" className="button secondary" onClick={onCancel}>キャンセル</button>
    </div>
  </section></div>
}
