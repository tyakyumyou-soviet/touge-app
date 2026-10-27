import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { backdropSheetSnap, boundedDownwardSheetOffset, nextSheetSnap, raisedSheetHeight, type SheetSnap } from '../lib/sheetGeometry'

const handleSelector = '.mobile-sheet-drag-region,.detail-sheet-top,.detail-peek-handle,.explore-panel-top,.course-list-drag-area'
const controlSelector = 'button,input,select,textarea,a,label,[data-sheet-no-drag]'
type SheetController = { name?: string; open: () => void; setForeground: (value: boolean) => void; minimize: () => void }
const sheetControllers = new Map<string, SheetController>()
const sheetStack: string[] = []

/** Opening an existing minimized panel must restore it, not only set an
 * already-true React open flag. All surface entry points use this contract. */
export function reopenMobileSheet(name: string) {
  const controller = [...sheetControllers.values()].find((entry) => entry.name === name)
  controller?.open()
}

function focusSheet(sheetId: string) {
  if (typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches) {
    sheetControllers.forEach((controller) => controller.setForeground(true))
    return
  }
  const previousIndex = sheetStack.indexOf(sheetId)
  if (previousIndex >= 0) sheetStack.splice(previousIndex, 1)
  sheetStack.push(sheetId)
  sheetControllers.forEach((controller, id) => {
    controller.setForeground(id === sheetId)
    if (id !== sheetId) controller.minimize()
  })
}

function removeSheet(sheetId: string) {
  sheetControllers.delete(sheetId)
  const wasActive = sheetStack.at(-1) === sheetId
  const index = sheetStack.indexOf(sheetId)
  if (index >= 0) sheetStack.splice(index, 1)
  if (!wasActive) return
  const fallback = sheetStack.at(-1)
  if (fallback) {
    sheetControllers.get(fallback)?.setForeground(true)
    sheetControllers.forEach((controller, id) => { if (id !== fallback) controller.setForeground(false) })
  } else sheetControllers.forEach((controller) => controller.setForeground(true))
}

/** Shared gesture contract for every mobile bottom sheet (機能A).
 * Attach dragProps to the sheet's entire non-interactive top region and apply
 * className/style to the sheet itself. New bottom sheets should use this hook. */
export function useMobileSheet(enabled = true, name?: string) {
  const sheetId = useId()
  const drag = useRef<{ source: 'pointer' | 'touch'; id: number; y: number; moved: boolean; startedMinimized: boolean; height: number; minimumVisibleHeight: number; maximumHeight: number } | null>(null)
  const scrollDrag = useRef<{ y: number; active: boolean; height: number; minimumVisibleHeight: number } | null>(null)
  const ignoreTap = useRef(false)
  const motionFrame = useRef<number | null>(null)
  const pendingMotion = useRef<{ height?: number; offset: number } | null>(null)
  const scrollMoveCleanup = useRef<(() => void) | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [foreground, setForeground] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [offset, setOffset] = useState(0)
  const [dragHeight, setDragHeight] = useState<number>()
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches

  const clearMotion = useCallback(() => {
    if (motionFrame.current !== null) window.cancelAnimationFrame(motionFrame.current)
    motionFrame.current = null
    pendingMotion.current = null
  }, [])
  const clearScrollMove = useCallback(() => { scrollMoveCleanup.current?.(); scrollMoveCleanup.current = null }, [])
  const openResting = useCallback(() => {
    clearMotion()
    clearScrollMove()
    ignoreTap.current = false
    drag.current = null
    scrollDrag.current = null
    setDragging(false)
    setDragHeight(undefined)
    if (enabled) focusSheet(sheetId)
    setCollapsed(false)
    setExpanded(false)
    setOffset(0)
  }, [enabled, sheetId, clearMotion, clearScrollMove])

  function updateMotion(height: number | undefined, nextOffset: number) {
    pendingMotion.current = { height, offset: nextOffset }
    if (motionFrame.current !== null) return
    motionFrame.current = window.requestAnimationFrame(() => {
      motionFrame.current = null
      const next = pendingMotion.current
      if (!next) return
      setDragHeight(next.height)
      setOffset(next.offset)
    })
  }

  function safeViewportClearance() {
    // CSS env() values are not directly readable in JS. A short-lived probe
    // gives the drag limiter the same Dynamic Island / home-indicator spacing
    // as the CSS expanded-sheet rule.
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const top = Math.max(12, Number.parseFloat(style.paddingTop) || 0)
    const bottom = Math.max(8, Number.parseFloat(style.paddingBottom) || 0)
    probe.remove()
    return top + bottom
  }

  function minimizedHeight(sheet: HTMLElement | null) {
    if (!sheet) return 54
    const configured = Number.parseFloat(getComputedStyle(sheet).getPropertyValue('--mobile-sheet-minimized-height'))
    return Number.isFinite(configured) && configured > 0 ? configured : 54
  }

  useEffect(() => {
    if (!enabled) return
    sheetControllers.set(sheetId, {
      name,
      open: openResting,
      setForeground,
      minimize: () => {
        clearMotion()
        clearScrollMove()
        drag.current = null
        scrollDrag.current = null
        setDragging(false)
        setCollapsed(true)
        setExpanded(false)
        setOffset(0)
        setDragHeight(undefined)
      },
    })
    openResting()
    return () => { clearMotion(); clearScrollMove(); removeSheet(sheetId) }
  }, [enabled, name, sheetId, clearMotion, clearScrollMove, openResting])

  useEffect(() => {
    if (!enabled) return
    const syncForeground = () => {
      if (!isMobile()) sheetControllers.forEach((controller) => controller.setForeground(true))
      else if (sheetStack.length) focusSheet(sheetStack[sheetStack.length - 1])
    }
    window.addEventListener('resize', syncForeground)
    return () => window.removeEventListener('resize', syncForeground)
  }, [enabled])

  function startGesture(target: Element, currentTarget: HTMLElement, y: number, source: 'pointer' | 'touch', id: number) {
    if (!isMobile() || !target.closest(handleSelector) || target.closest(controlSelector)) return
    const scrollSurface = target.closest<HTMLElement>('[data-sheet-scroll]')
    if ((scrollSurface?.scrollTop ?? currentTarget.scrollTop) > 1) return
    const sheet = currentTarget.closest<HTMLElement>('.mobile-sheet') ?? currentTarget
    ignoreTap.current = false
    // Full sheets may use the entire viewport except for the small safe-area
    // clearance controlled in CSS. The old 76px cap stopped drag expansion far
    // below the top edge on phones.
    drag.current = { source, id, y, moved: false, startedMinimized: collapsed, height: sheet.getBoundingClientRect().height, minimumVisibleHeight: minimizedHeight(sheet), maximumHeight: Math.min(window.innerHeight - 76, window.innerHeight - safeViewportClearance()) }
    setDragging(true)
  }

  function moveGesture(id: number, y: number) {
    const active = drag.current
    if (!active || active.id !== id) return
    const distance = y - active.y
    if (Math.abs(distance) > 8) active.moved = true
    if (distance < 0) {
      if (collapsed) {
        focusSheet(sheetId)
        setCollapsed(false)
        setExpanded(false)
      }
      updateMotion(raisedSheetHeight(active.height, distance, active.maximumHeight), 0)
      return
    }
    if (collapsed) { updateMotion(undefined, Math.min(0, distance)); return }
    const downward = boundedDownwardSheetOffset(distance, active.height, active.minimumVisibleHeight)
    updateMotion(undefined, downward)
  }

  function endGesture(id: number, y: number) {
    const active = drag.current
    if (!active || active.id !== id) return
    const distance = y - active.y
    clearMotion()
    drag.current = null
    setDragHeight(undefined)
    setDragging(false)
    setOffset(0)
    ignoreTap.current = active.moved
    settle(distance, active.startedMinimized)
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
    moveGesture(touch.identifier, touch.clientY)
  }

  function endTouchHandle(event: ReactTouchEvent<HTMLElement>) {
    const active = drag.current
    if (!active || active.source !== 'touch') return
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === active.id)
    endGesture(active.id, touch?.clientY ?? active.y)
  }

  function cancel() {
    const wasDragging = Boolean(drag.current || scrollDrag.current?.active)
    clearMotion()
    clearScrollMove()
    drag.current = null
    scrollDrag.current = null
    if (wasDragging) ignoreTap.current = true
    setDragHeight(undefined)
    setDragging(false)
    setOffset(0)
  }

  function settle(distance: number, startedMinimized = false) {
    const current: SheetSnap = startedMinimized || collapsed ? 'minimized' : expanded ? 'full' : 'middle'
    // A deliberate long upward swipe from the compact tray should open the
    // sheet fully in one continuous move, not stop at an intermediate step
    // that forces the user to drag again.
    const next = startedMinimized && distance < -120 ? 'full' : nextSheetSnap(current, distance)
    if (next !== 'minimized') focusSheet(sheetId)
    setCollapsed(next === 'minimized')
    setExpanded(next === 'full')
  }

  /**
   * Lets a scrollable sheet body hand a downward pull to the sheet once it has
   * reached its top. This keeps the native scroll behaviour everywhere else.
   */
  function startScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    clearScrollMove()
    // Header pointer handling and body scrolling must never own the same touch.
    if (drag.current || (event.target as Element).closest(`${handleSelector},${controlSelector}`)) return
    if (!isMobile() || event.touches.length !== 1 || event.currentTarget.scrollTop > 1) return
    const sheet = event.currentTarget.closest<HTMLElement>('.mobile-sheet')
    scrollDrag.current = { y: event.touches[0].clientY, active: false, height: sheet?.getBoundingClientRect().height ?? 54, minimumVisibleHeight: minimizedHeight(sheet) }
    // React's delegated touchmove listener is passive in mobile browsers.
    // A temporary native listener can actually prevent page scrolling once
    // this gesture becomes a sheet drag, and is removed at release/cancel.
    const surface = event.currentTarget
    const onMove = (moveEvent: TouchEvent) => moveScrollDrag(moveEvent, surface)
    surface.addEventListener('touchmove', onMove, { passive: false })
    scrollMoveCleanup.current = () => surface.removeEventListener('touchmove', onMove)
  }

  function moveScrollDrag(event: TouchEvent, surface: HTMLElement) {
    const active = scrollDrag.current
    if (!active || event.touches.length !== 1) return
    const distance = event.touches[0].clientY - active.y
    if (surface.scrollTop > 1 && !active.active) {
      scrollDrag.current = null
      clearScrollMove()
      return
    }
    if (distance <= 8 && !active.active) return
    if (distance <= 0) {
      if (active.active) updateMotion(undefined, 0)
      return
    }
    active.active = true
    // Once the content cannot scroll upward any further, the gesture should
    // behave exactly like pulling the sheet by its fixed handle.
    if (event.cancelable) event.preventDefault()
    setDragging(true)
    updateMotion(undefined, boundedDownwardSheetOffset(distance, active.height, active.minimumVisibleHeight))
  }

  function endScrollDrag(event: ReactTouchEvent<HTMLElement>) {
    clearScrollMove()
    const active = scrollDrag.current
    if (!active) return
    const endY = event.changedTouches[0]?.clientY ?? active.y
    const distance = endY - active.y
    scrollDrag.current = null
    if (!active.active) return
    clearMotion()
    ignoreTap.current = true
    setDragging(false)
    setOffset(0)
    settle(distance)
  }

  function tap(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile()) return
    // A drag/cancel can be followed by one synthetic click. Consume only that
    // click; keeping this flag set made every later handle tap inert.
    if (ignoreTap.current) {
      ignoreTap.current = false
      return
    }
    if (!collapsed || !(event.target as Element).closest(handleSelector) || (event.target as Element).closest(controlSelector)) return
    openResting()
  }

  /** Advance one snap from an explicit tap on a component's top area.
   * Components that provide their own header handler use this instead of the
   * root tap delegate, so it must preserve the same minimized → middle → full
   * contract and consume the synthetic click emitted after a drag. */
  function expandOnTap(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile()) return
    if (ignoreTap.current) {
      ignoreTap.current = false
      return
    }
    if ((event.target as Element).closest('button,input,select,textarea,a,label,[data-sheet-no-drag]')) return
    if (collapsed) {
      openResting()
      return
    }
    if (expanded) return
    focusSheet(sheetId)
    setCollapsed(false)
    setExpanded(true)
    setOffset(0)
  }

  function tapBackdrop(event: ReactMouseEvent<HTMLElement>) {
    if (!isMobile() || event.target !== event.currentTarget) return
    const current: SheetSnap = collapsed ? 'minimized' : expanded ? 'full' : 'middle'
    if (backdropSheetSnap(current) !== 'middle') return
    if (!expanded) return
    setExpanded(false)
    setCollapsed(false)
    setOffset(0)
    setDragHeight(undefined)
  }

  const reset = useCallback(() => {
    clearMotion()
    clearScrollMove()
    drag.current = null
    scrollDrag.current = null
    ignoreTap.current = false
    setCollapsed(false)
    setExpanded(false)
    setDragging(false)
    setOffset(0)
    setDragHeight(undefined)
  }, [clearMotion, clearScrollMove])

  const collapse = useCallback(() => {
    reset()
    setCollapsed(true)
  }, [reset])

  const className = `mobile-sheet ${expanded ? 'expanded' : ''} ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''} ${foreground ? '' : 'sheet-backgrounded'}`
  const style: CSSProperties | undefined = dragHeight !== undefined
    ? { height: dragHeight, maxHeight: dragHeight, transform: 'none' }
    : collapsed
    ? { height: 'var(--mobile-sheet-minimized-height, 54px)', maxHeight: 'var(--mobile-sheet-minimized-height, 54px)', transform: `translateY(${offset}px)` }
    : offset ? { transform: `translateY(${offset}px)` } : undefined

  return {
    className,
    style,
    reset,
    collapse,
    openResting,
    expandOnTap,
    backdropProps: { onClick: tapBackdrop },
    // Root delegation is supported, but only designated headers start drags.
    dragProps: {
      onPointerDown: start, onPointerMove: move, onPointerUp: end, onPointerCancel: cancel,
      onTouchStart: startTouchHandle, onTouchMove: moveTouchHandle, onTouchEnd: endTouchHandle, onTouchCancel: cancel,
      onClick: tap,
    },
    scrollProps: { onTouchStart: startScrollDrag, onTouchEnd: endScrollDrag, onTouchCancel: cancel },
  }
}
