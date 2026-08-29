import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'

/** Shared gesture contract for every mobile bottom sheet (機能A).
 * Attach dragProps to the sheet's entire non-interactive top region and apply
 * className/style to the sheet itself. New bottom sheets should use this hook. */
export function useMobileSheet() {
  const drag = useRef<{ pointerId: number; y: number; moved: boolean } | null>(null)
  const scrollDrag = useRef<{ y: number; active: boolean } | null>(null)
  const ignoreTap = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches

  function start(event: ReactPointerEvent<HTMLElement>) {
    if (!isMobile() || (event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    const scrollSurface = (event.target as Element).closest<HTMLElement>('[data-sheet-scroll]')
    if ((scrollSurface?.scrollTop ?? event.currentTarget.scrollTop) > 1) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture is optional in synthetic tests. */ }
    drag.current = { pointerId: event.pointerId, y: event.clientY, moved: false }
    setDragging(true)
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const distance = event.clientY - active.y
    if (Math.abs(distance) > 8) active.moved = true
    setOffset(collapsed ? Math.min(0, distance) : expanded ? Math.max(0, distance) : Math.max(-180, distance))
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const distance = event.clientY - active.y
    drag.current = null
    setDragging(false)
    setOffset(0)
    ignoreTap.current = active.moved
    if (active.moved) window.setTimeout(() => { ignoreTap.current = false }, 0)
    settle(distance)
  }

  function settle(distance: number) {
    if (collapsed) {
      if (distance < -42) { setCollapsed(false); setExpanded(true) }
      return
    }
    if (distance > 52) { setCollapsed(true); setExpanded(false) }
    else if (distance < -52) setExpanded(true)
    else if (distance > 24) setExpanded(false)
  }

  /**
   * Lets a scrollable sheet body hand a downward pull to the sheet once it has
   * reached its top. This keeps the native scroll behaviour everywhere else.
   */
  function startScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    if (!isMobile() || event.touches.length !== 1 || event.currentTarget.scrollTop > 1) return
    scrollDrag.current = { y: event.touches[0].clientY, active: false }
  }

  function moveScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    const active = scrollDrag.current
    if (!active || event.touches.length !== 1) return
    const distance = event.touches[0].clientY - active.y
    if (event.currentTarget.scrollTop > 1 && !active.active) {
      scrollDrag.current = null
      return
    }
    if (distance <= 8 && !active.active) return
    if (distance <= 0) return
    active.active = true
    // Once the content cannot scroll upward any further, the gesture should
    // behave exactly like pulling the sheet by its fixed handle.
    event.preventDefault()
    setDragging(true)
    setOffset(Math.max(0, distance))
  }

  function endScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    const active = scrollDrag.current
    if (!active) return
    const endY = event.changedTouches[0]?.clientY ?? active.y
    const distance = endY - active.y
    scrollDrag.current = null
    if (!active.active) return
    setDragging(false)
    setOffset(0)
    settle(distance)
  }

  function tap(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile() || ignoreTap.current || !collapsed || (event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    setCollapsed(false)
    setExpanded(false)
    setOffset(0)
  }

  function reset() {
    drag.current = null
    scrollDrag.current = null
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
    // Attach to the full sheet surface. Interactive controls and a scrolled
    // body are excluded above, so form/list operation remains native.
    dragProps: { onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: end, onClick: tap },
    scrollProps: { onTouchStart: startScrollDrag, onTouchMove: moveScrollDrag, onTouchEnd: endScrollDrag, onTouchCancel: endScrollDrag },
  }
}
