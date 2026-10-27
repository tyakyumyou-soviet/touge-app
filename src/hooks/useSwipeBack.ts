import { useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react'
import { flushSync } from 'react-dom'

const claimedStarts = new WeakSet<Event>()
const handledTouches = new WeakSet<Event>()
const excludedTargets = 'input, textarea, select, [contenteditable="true"], [role="slider"], [draggable="true"], [data-swipe-back-ignore], .route-drag-handle'
const settleMs = 200
type Motion = { element: HTMLElement; translate: string; transition: string; willChange: string }
type Gesture = { id: number; x: number; y: number; horizontal: boolean; motion: Motion; reduceMotion: boolean }

/** Nested views claim the gesture first. Only the screen content moves: the
 * bottom sheet's own vertical position and snap state remain independent. */
export function useSwipeBack(onBack: (() => void) | undefined, motionSelector?: string) {
  const gesture = useRef<Gesture | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const motion = useRef<Motion | null>(null)
  const timer = useRef<number | null>(null)

  function clearGesture() {
    cleanup.current?.()
    cleanup.current = null
    gesture.current = null
  }
  function clearMotion() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const current = motion.current
    if (current) {
      current.element.style.translate = current.translate
      current.element.style.transition = current.transition
      current.element.style.willChange = current.willChange
    }
    motion.current = null
  }
  useEffect(() => () => { cleanup.current?.(); clearMotion() }, [])

  function start(event: ReactTouchEvent<HTMLElement>) {
    clearGesture()
    clearMotion()
    if (!onBack || !window.matchMedia('(max-width: 760px)').matches || event.touches.length !== 1 || claimedStarts.has(event.nativeEvent)) return
    const target = event.target as Element
    if (target === event.currentTarget && target.classList.contains('modal-backdrop')) return
    if (target.closest(excludedTargets)) return
    for (let node: Element | null = target; node && node !== event.currentTarget; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth + 1) return
    }
    const surface = event.currentTarget
    const element = motionSelector ? surface.querySelector<HTMLElement>(motionSelector) : surface
    if (!element) return
    claimedStarts.add(event.nativeEvent)
    const touch = event.touches[0]
    const current = { element, translate: element.style.translate, transition: element.style.transition, willChange: element.style.willChange }
    motion.current = current
    gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, horizontal: false, motion: current, reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
    const move = (moveEvent: TouchEvent) => {
      const active = gesture.current
      if (!active || moveEvent.touches.length !== 1) { clearGesture(); clearMotion(); return }
      const point = Array.from(moveEvent.touches).find((item) => item.identifier === active.id)
      if (!point) { clearGesture(); clearMotion(); return }
      const dx = point.clientX - active.x
      const dy = point.clientY - active.y
      if (!active.horizontal && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
        if (dx <= 0 || dx < Math.abs(dy) * 1.4) { clearGesture(); clearMotion(); return }
        active.horizontal = true
        if (!active.reduceMotion) {
          active.motion.element.style.transition = 'none'
          active.motion.element.style.willChange = 'translate'
        }
      }
      if (active.horizontal) {
        if (moveEvent.cancelable) moveEvent.preventDefault()
        if (!active.reduceMotion) active.motion.element.style.translate = `${Math.max(0, dx)}px 0px`
      }
    }
    surface.addEventListener('touchmove', move, { passive: false })
    cleanup.current = () => surface.removeEventListener('touchmove', move)
  }

  function settle(active: Gesture, commit: boolean) {
    if (!active.horizontal || active.reduceMotion) {
      if (commit && onBack) flushSync(onBack)
      clearMotion()
      return
    }
    const element = active.motion.element
    // Commit the finger-following position before starting the settle
    // transition, including when the final move and release share a frame.
    element.getBoundingClientRect()
    element.style.transition = `translate ${settleMs}ms cubic-bezier(.2, .7, .2, 1)`
    element.style.translate = commit ? '100% 0px' : active.motion.translate || '0px 0px'
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (commit && onBack) flushSync(onBack)
      clearMotion()
    }, settleMs)
  }

  function end(event: ReactTouchEvent<HTMLElement>) {
    const active = gesture.current
    const touch = active && Array.from(event.changedTouches).find((item) => item.identifier === active.id)
    clearGesture()
    if (!onBack || !active || !touch || event.touches.length || handledTouches.has(event.nativeEvent)) { clearMotion(); return }
    const dx = touch.clientX - active.x
    const dy = touch.clientY - active.y
    const commit = active.horizontal && dx >= 64 && dx >= Math.abs(dy) * 1.4
    if (commit) {
      handledTouches.add(event.nativeEvent)
      if (event.cancelable) event.preventDefault()
    }
    settle(active, commit)
  }

  function cancel() {
    const active = gesture.current
    clearGesture()
    if (active) settle(active, false)
    else clearMotion()
  }

  return { onTouchStart: start, onTouchEnd: end, onTouchCancel: cancel }
}
