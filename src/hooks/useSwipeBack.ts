import { useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react'

const handledTouches = new WeakSet<Event>()
const excludedTargets = 'input, textarea, select, [contenteditable="true"], [role="slider"], [draggable="true"], [data-swipe-back-ignore], .route-drag-handle'

/** Rightward touch gestures use the same action as the current view's back
 * button. Nested views get first refusal, and native vertical/horizontal
 * scrolling remains untouched until the gesture is clearly horizontal. */
export function useSwipeBack(onBack: (() => void) | undefined) {
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  function clear() {
    cleanup.current?.()
    cleanup.current = null
    gesture.current = null
  }

  useEffect(() => () => { cleanup.current?.() }, [])

  function start(event: ReactTouchEvent<HTMLElement>) {
    clear()
    if (!onBack || !window.matchMedia('(max-width: 760px)').matches || event.touches.length !== 1) return
    const target = event.target as Element
    if (target === event.currentTarget && target.classList.contains('modal-backdrop')) return
    if (target.closest(excludedTargets)) return
    // A carousel, tab strip or other genuine horizontal scroller owns its
    // own gesture, even when it is nested inside a back-enabled panel.
    for (let node: Element | null = target; node && node !== event.currentTarget; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth + 1) return
    }
    const touch = event.touches[0]
    gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, horizontal: false }
    const surface = event.currentTarget
    const move = (moveEvent: TouchEvent) => {
      const active = gesture.current
      if (!active || moveEvent.touches.length !== 1) { clear(); return }
      const point = Array.from(moveEvent.touches).find((item) => item.identifier === active.id)
      if (!point) { clear(); return }
      const dx = point.clientX - active.x
      const dy = point.clientY - active.y
      if (!active.horizontal && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
        if (dx <= 0 || dx < Math.abs(dy) * 1.4) { clear(); return }
        active.horizontal = true
      }
      if (active.horizontal && moveEvent.cancelable) moveEvent.preventDefault()
    }
    surface.addEventListener('touchmove', move, { passive: false })
    cleanup.current = () => surface.removeEventListener('touchmove', move)
  }

  function end(event: ReactTouchEvent<HTMLElement>) {
    const active = gesture.current
    const touch = active && Array.from(event.changedTouches).find((item) => item.identifier === active.id)
    clear()
    if (!onBack || !active || !touch || event.touches.length || handledTouches.has(event.nativeEvent)) return
    const dx = touch.clientX - active.x
    const dy = touch.clientY - active.y
    if (active.horizontal && dx >= 64 && dx >= Math.abs(dy) * 1.4) {
      handledTouches.add(event.nativeEvent)
      if (event.cancelable) event.preventDefault()
      onBack()
    }
  }

  return { onTouchStart: start, onTouchEnd: end, onTouchCancel: clear }
}
