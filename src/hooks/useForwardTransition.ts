import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

const durationMs = 180

/** Finish the outgoing view before mounting the next one, so the two views
 * cannot paint over each other. The sheet itself remains stationary. */
export function useForwardTransition() {
  const pending = useRef<{ timer: number; element: HTMLElement } | null>(null)
  const cancel = useCallback(() => {
    const current = pending.current
    if (!current) return
    window.clearTimeout(current.timer)
    current.element.classList.remove('forward-view-exiting')
    pending.current = null
  }, [])
  useEffect(() => cancel, [cancel])

  const forward = useCallback((element: HTMLElement | null, next: () => void) => {
    if (pending.current) return
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      next()
      return
    }
    element.classList.add('forward-view-exiting')
    const timer = window.setTimeout(() => {
      pending.current = null
      // Replace the outgoing view before removing its exit style. This also
      // prevents a one-frame flash when the old view remains mounted behind.
      flushSync(next)
      element.classList.remove('forward-view-exiting')
    }, durationMs)
    pending.current = { timer, element }
  }, [])
  return { forward, cancel }
}
