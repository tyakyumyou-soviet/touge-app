import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { boundedDownwardSheetOffset, nextSheetSnap, raisedSheetHeight, type SheetSnap } from '../lib/sheetGeometry'

const handleSelector = '.mobile-sheet-drag-region,.detail-sheet-top,.detail-peek-handle,.explore-panel-top,.course-list-drag-area'
const controlSelector = 'button,input,select,textarea,a,label,[data-sheet-no-drag]'

/** Shared gesture contract for every mobile bottom sheet (機能A).
 * Attach dragProps to the sheet's entire non-interactive top region and apply
 * className/style to the sheet itself. New bottom sheets should use this hook. */
export function useMobileSheet() {
  const drag = useRef<{ source: 'pointer' | 'touch'; id: number; y: number; moved: boolean; height: number; maximumHeight: number } | null>(null)
  const scrollDrag = useRef<{ y: number; active: boolean; height: number } | null>(null)
  const ignoreTap = useRef(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)
  const [dragHeight, setDragHeight] = useState<number>()
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches

  function startGesture(target: Element, currentTarget: HTMLElement, y: number, source: 'pointer' | 'touch', id: number) {
    if (!isMobile() || !target.closest(handleSelector) || target.closest(controlSelector)) return
    const scrollSurface = target.closest<HTMLElement>('[data-sheet-scroll]')
    if ((scrollSurface?.scrollTop ?? currentTarget.scrollTop) > 1) return
    const sheet = currentTarget.closest<HTMLElement>('.mobile-sheet') ?? currentTarget
    ignoreTap.current = false
    drag.current = { source, id, y, moved: false, height: collapsed ? 54 : sheet.getBoundingClientRect().height, maximumHeight: window.innerHeight - 76 }
    setDragging(true)
  }

  function moveGesture(id: number, y: number) {
    const active = drag.current
    if (!active || active.id !== id) return
    const distance = y - active.y
    if (Math.abs(distance) > 8) active.moved = true
    if (distance < 0) {
      setDragHeight(raisedSheetHeight(active.height, distance, active.maximumHeight))
      setOffset(0)
      return
    }
    setDragHeight(undefined)
    if (collapsed) { setOffset(Math.min(0, distance)); return }
    const downward = boundedDownwardSheetOffset(distance, active.height)
    setOffset(expanded ? downward : distance < 0 ? Math.max(-180, distance) : downward)
  }

  function endGesture(id: number, y: number) {
    const active = drag.current
    if (!active || active.id !== id) return
    const distance = y - active.y
    drag.current = null
    setDragHeight(undefined)
    setDragging(false)
    setOffset(0)
    ignoreTap.current = active.moved
    settle(distance)
  }

  function start(event: ReactPointerEvent<HTMLElement>) {
    // iOS Safari needs the explicit Touch Events path below. Mixing both paths
    // makes Safari dispatch a pointercancel midway through a drag.
    if (event.pointerType === 'touch') return
    startGesture(event.target as Element, event.currentTarget, event.clientY, 'pointer', event.pointerId)
    if (drag.current?.source === 'pointer') {
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Optional. */ }
    }
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') return
    moveGesture(event.pointerId, event.clientY)
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') return
    endGesture(event.pointerId, event.clientY)
  }

  function startTouchHandle(event: ReactTouchEvent<HTMLElement>) {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    startGesture(event.target as Element, event.currentTarget, touch.clientY, 'touch', touch.identifier)
  }

  function moveTouchHandle(event: ReactTouchEvent<HTMLElement>) {
    const active = drag.current
    if (!active || active.source !== 'touch') return
    const touch = Array.from(event.touches).find((item) => item.identifier === active.id)
    if (!touch) return
    event.preventDefault()
    moveGesture(touch.identifier, touch.clientY)
  }

  function endTouchHandle(event: ReactTouchEvent<HTMLElement>) {
    const active = drag.current
    if (!active || active.source !== 'touch') return
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === active.id)
    endGesture(active.id, touch?.clientY ?? active.y)
  }

  function cancel() {
    drag.current = null
    scrollDrag.current = null
    ignoreTap.current = true
    setDragHeight(undefined)
    setDragging(false)
    setOffset(0)
  }

  function settle(distance: number) {
    const current: SheetSnap = collapsed ? 'minimized' : expanded ? 'full' : 'middle'
    const next = nextSheetSnap(current, distance)
    setCollapsed(next === 'minimized')
    setExpanded(next === 'full')
  }

  /**
   * Lets a scrollable sheet body hand a downward pull to the sheet once it has
   * reached its top. This keeps the native scroll behaviour everywhere else.
   */
  function startScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    // Header pointer handling and body scrolling must never own the same touch.
    if (drag.current || (event.target as Element).closest(handleSelector + ',input,select,textarea,[data-sheet-no-drag]')) return
    if (!isMobile() || event.touches.length !== 1 || event.currentTarget.scrollTop > 1) return
    const sheet = event.currentTarget.closest<HTMLElement>('.mobile-sheet')
    scrollDrag.current = { y: event.touches[0].clientY, active: false, height: sheet?.getBoundingClientRect().height ?? 54 }
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
    if (distance <= 0) {
      if (active.active) setOffset(0)
      return
    }
    active.active = true
    // Once the content cannot scroll upward any further, the gesture should
    // behave exactly like pulling the sheet by its fixed handle.
    event.preventDefault()
    setDragging(true)
    setOffset(boundedDownwardSheetOffset(distance, active.height))
  }

  function endScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    const active = scrollDrag.current
    if (!active) return
    const endY = event.changedTouches[0]?.clientY ?? active.y
    const distance = endY - active.y
    scrollDrag.current = null
    if (!active.active) return
    ignoreTap.current = true
    setDragging(false)
    setOffset(0)
    settle(distance)
  }

  function tap(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile() || ignoreTap.current || !collapsed || !(event.target as Element).closest(handleSelector) || (event.target as Element).closest(controlSelector)) return
    openResting()
  }

  function openResting() {
    setCollapsed(false)
    setExpanded(false)
    setOffset(0)
  }

  /** Expand only from an explicit tap on a component's designated top area. */
  function expandOnTap(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile() || ignoreTap.current || (event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    setCollapsed(false)
    setExpanded(true)
    setOffset(0)
  }

  const reset = useCallback(() => {
    drag.current = null
    scrollDrag.current = null
    ignoreTap.current = false
    setCollapsed(false)
    setExpanded(false)
    setDragging(false)
    setOffset(0)
    setDragHeight(undefined)
  }, [])

  const collapse = useCallback(() => {
    reset()
    setCollapsed(true)
  }, [reset])

  const className = `mobile-sheet ${expanded ? 'expanded' : ''} ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''}`
  const style: CSSProperties | undefined = dragHeight !== undefined
    ? { height: dragHeight, maxHeight: dragHeight, transform: 'none' }
    : collapsed
    ? { transform: `translateY(calc(100% - 54px + ${offset}px))` }
    : offset ? { transform: `translateY(${offset}px)` } : undefined

  return {
    className,
    style,
    reset,
    collapse,
    openResting,
    expandOnTap,
    // Root delegation is supported, but only designated headers start drags.
    dragProps: {
      onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: cancel,
      onTouchStart: startTouchHandle, onTouchMove: moveTouchHandle, onTouchEnd: endTouchHandle, onTouchCancel: cancel,
      onClick: tap,
    },
    scrollProps: { onTouchStart: startScrollDrag, onTouchMove: moveScrollDrag, onTouchEnd: endScrollDrag, onTouchCancel: cancel },
  }
}
