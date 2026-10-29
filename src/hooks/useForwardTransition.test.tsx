// @vitest-environment jsdom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForwardTransition } from './useForwardTransition'

function Views() {
  const [view, setView] = useState('一覧')
  const content = useRef<HTMLDivElement>(null)
  const { forward, cancel } = useForwardTransition()
  return <><button onClick={() => forward(content.current, () => setView('詳細'))}>進む</button><button onClick={cancel}>キャンセル</button><div ref={content}>{view}</div></>
}

function StackedViews() {
  const [opened, setOpened] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const { forward } = useForwardTransition()
  return <><section className={opened ? 'mobile-sheet sheet-backgrounded' : 'mobile-sheet'}><div ref={content}>一覧</div><button onClick={() => forward(content.current, () => setOpened(true))}>進む</button></section>{opened && <section>詳細</section>}</>
}

describe('forward transitions', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
  })
  it('moves the outgoing view away before replacing it, without leaving its exit style', async () => {
    await act(async () => root.render(<Views />))
    const [next] = container.querySelectorAll('button')
    const view = container.querySelector('div')!
    await act(async () => { next.click(); next.click() })
    expect(view.textContent).toBe('一覧')
    expect(view.className).toContain('forward-view-exiting')
    await act(async () => {
      const end = new Event('animationend', { bubbles: true })
      Object.defineProperty(end, 'animationName', { value: 'forward-view-exit' })
      view.dispatchEvent(end)
    })
    expect(view.textContent).toBe('詳細')
    expect(view.className).not.toContain('forward-view-exiting')
  })
  it('does not navigate on an unrelated animation and has a fallback if completion is missed', async () => {
    await act(async () => root.render(<Views />))
    const view = container.querySelector('div')!
    await act(async () => { container.querySelector('button')!.click() })
    await act(async () => {
      const end = new Event('animationend', { bubbles: true })
      Object.defineProperty(end, 'animationName', { value: 'other-animation' })
      view.dispatchEvent(end)
      vi.advanceTimersByTime(180)
    })
    expect(view.textContent).toBe('一覧')
    await act(async () => { vi.advanceTimersByTime(170) })
    expect(view.textContent).toBe('詳細')
  })
  it('cancels a pending transition without navigating', async () => {
    await act(async () => root.render(<Views />))
    const [next, cancel] = container.querySelectorAll('button')
    await act(async () => { next.click(); cancel.click(); vi.runAllTimers() })
    expect(container.querySelector('div')?.textContent).toBe('一覧')
    expect(container.querySelector('div')?.className).not.toContain('forward-view-exiting')
  })
  it('keeps the old composited layer hidden through the next paint', async () => {
    await act(async () => root.render(<StackedViews />))
    const view = container.querySelector('section div')!
    await act(async () => { container.querySelector('button')!.click() })
    await act(async () => {
      const end = new Event('animationend', { bubbles: true })
      Object.defineProperty(end, 'animationName', { value: 'forward-view-exit' })
      view.dispatchEvent(end)
    })
    expect(container.querySelector('.sheet-backgrounded')).not.toBeNull()
    expect(view.className).toContain('forward-view-complete')
    await act(async () => { vi.advanceTimersByTime(32) })
    expect(view.className).not.toContain('forward-view-complete')
  })
  it('navigates immediately when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    await act(async () => root.render(<Views />))
    await act(async () => { container.querySelector('button')!.click() })
    expect(container.querySelector('div')?.textContent).toBe('詳細')
  })
})
