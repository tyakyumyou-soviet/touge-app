import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

/** Shared gesture contract for every mobile bottom sheet (機能A).
 * Attach dragProps to the sheet's entire non-interactive top region and apply
 * className/style to the sheet itself. New bottom sheets should use this hook. */
export function useMobileSheet() {
  const drag = useRef<{ pointerId: number; y: number; moved: boolean } | null>(null)
  const ignoreTap = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isMobile() || (event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture is optional in synthetic tests. */ }
    drag.current = { pointerId: event.pointerId, y: event.clientY, moved: false }
    setDragging(true)
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const distance = event.clientY - active.y
    if (Math.abs(distance) > 8) active.moved = true
    setOffset(collapsed ? Math.min(0, distance) : Math.max(0, distance))
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const distance = event.clientY - active.y
    drag.current = null
    setDragging(false)
    setOffset(0)
    ignoreTap.current = active.moved
    if (active.moved) window.setTimeout(() => { ignoreTap.current = false }, 0)
    if (collapsed) {
      if (distance < -42) { setCollapsed(false); setExpanded(true) }
      return
    }
    if (distance > 52) { setCollapsed(true); setExpanded(false) }
    else if (distance < -52) setExpanded(true)
    else if (distance > 24) setExpanded(false)
  }

  function tap(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isMobile() || ignoreTap.current || !collapsed || (event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    setCollapsed(false)
    setExpanded(false)
    setOffset(0)
  }

  function reset() {
    drag.current = null
    ignoreTap.current = false
    setCollapsed(false)
    setExpanded(false)
    setDragging(false)
    setOffset(0)
  }

  const className = `mobile-sheet ${expanded ? 'expanded' : ''} ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''}`
  const style: CSSProperties | undefined = collapsed
    ? { transform: `translateY(calc(100% - 54px + ${offset}px))` }
    : offset ? { transform: `translateY(${offset}px)` } : undefined

  return {
    className,
    style,
    reset,
    dragProps: { onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: end, onClick: tap },
  }
}
