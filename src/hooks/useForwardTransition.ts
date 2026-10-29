import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

// A fallback is still needed if the animation is cancelled by the browser or
// the tab is backgrounded, but it must not race the actual animation duration.
const fallbackMs = 350

/** Finish the outgoing view before mounting the next one, so the two views
 * cannot paint over each other. The sheet itself remains stationary. */
export function useForwardTransition() {
  const pending = useRef<{ timer: number; frame: number | null; element: HTMLElement; onEnd: (event: AnimationEvent) => void; presenting: boolean } | null>(null)
  const deferredCleanup = useRef<(() => void) | null>(null)
  const cancel = useCallback(() => {
    const current = pending.current
    if (current) {
      window.clearTimeout(current.timer)
      if (current.frame !== null) window.cancelAnimationFrame(current.frame)
      current.element.removeEventListener('animationend', current.onEnd)
      current.element.classList.remove('forward-view-exiting', 'forward-view-complete')
      pending.current = null
    }
    deferredCleanup.current?.()
  }, [])
  useEffect(() => cancel, [cancel])

  const forward = useCallback((element: HTMLElement | null, next: () => void) => {
    if (pending.current) return
    deferredCleanup.current?.()
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      next()
      return
    }
    element.classList.add('forward-view-exiting')
    const finish = () => {
      const current = pending.current
      if (!current || current.presenting) return
      window.clearTimeout(current.timer)
      element.removeEventListener('animationend', current.onEnd)
      current.presenting = true
      element.classList.add('forward-view-complete')
      // React rendering and the incoming view's layout can block the main
      // thread. Painting the cleared outgoing view AFTER that work is too late:
      // the last partially visible animation frame stays onscreen meanwhile.
      // Two frames give the browser a paint opportunity BEFORE mounting next.
      current.frame = window.requestAnimationFrame(() => {
        current.frame = window.requestAnimationFrame(() => {
          if (pending.current !== current) return
          pending.current = null
          flushSync(next)
          const cleanup = () => {
            element.classList.remove('forward-view-exiting', 'forward-view-complete')
            deferredCleanup.current = null
          }
          if (element.isConnected && element.closest('.sheet-backgrounded, .covered-by-detail')) {
            let frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(cleanup) })
            deferredCleanup.current = () => { window.cancelAnimationFrame(frame); cleanup() }
          } else cleanup()
        })
      })
    }
    const onEnd = (event: AnimationEvent) => {
      if (event.target === element && event.animationName === 'forward-view-exit') finish()
    }
    element.addEventListener('animationend', onEnd)
    const timer = window.setTimeout(finish, fallbackMs)
    pending.current = { timer, frame: null, element, onEnd, presenting: false }
  }, [])
  return { forward, cancel }
}
