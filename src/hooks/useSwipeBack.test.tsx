// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSwipeBack } from './useSwipeBack'
import { useMobileSheet } from './useMobileSheet'
import { FriendListsPanel } from '../components/FriendListsPanel'

function Panel({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return <section {...useSwipeBack(onBack)}>{children}</section>
}

function MovablePanel({ onBack }: { onBack: () => void }) {
  const sheet = useMobileSheet()
  return <section className={sheet.className} style={sheet.style} {...useSwipeBack(onBack)}>
    <div data-sheet-scroll {...sheet.scrollProps}><p>スクロール可能な本文</p></div>
  </section>
}

function touch(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 1, clientX: x, clientY: y }
  Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] }, changedTouches: { value: [point] } })
  target.dispatchEvent(event)
  return event
}

describe('swipe back', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('follows the finger and finishes the exit before navigating', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><p>設定</p></Panel>))
    const target = container.querySelector('p')!
    const panel = container.querySelector<HTMLElement>('section')!
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 110, 105) })
    expect(panel.style.translate).toBe('80px 0px')
    expect(back).not.toHaveBeenCalled()
    await act(async () => { touch(target, 'touchend', 130, 105) })
    expect(panel.style.translate).toBe('100% 0px')
    expect(back).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(back).toHaveBeenCalledOnce()
    expect(panel.style.translate).toBe('')
  })

  it('animates an incomplete swipe back to its original position', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><p>設定</p></Panel>))
    const target = container.querySelector('p')!
    const panel = container.querySelector<HTMLElement>('section')!
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 70, 102); touch(target, 'touchend', 70, 102) })
    expect(panel.style.translate).toBe('0px 0px')
    expect(panel.style.transition).toContain('200ms')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(panel.style.translate).toBe('')
    expect(back).not.toHaveBeenCalled()
  })

  it('moves only the inner view for a nested gesture', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
    const outer = vi.fn(), inner = vi.fn()
    await act(async () => root.render(<Panel onBack={outer}><Panel onBack={inner}><p>リスト編集</p></Panel></Panel>))
    const target = container.querySelector('p')!
    const [outerPanel, innerPanel] = container.querySelectorAll<HTMLElement>('section')
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 110, 105) })
    expect(outerPanel.style.translate).toBe('')
    expect(innerPanel.style.translate).toBe('80px 0px')
    await act(async () => { touch(target, 'touchend', 130, 105); vi.advanceTimersByTime(200) })
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
  })

  it('returns exactly once on a deliberate rightward swipe', async () => {
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><p>設定</p></Panel>))
    const target = container.querySelector('p')!
    let moved: Event
    await act(async () => { touch(target, 'touchstart', 30, 100); moved = touch(target, 'touchmove', 90, 106); touch(target, 'touchend', 130, 110) })
    expect(moved!.defaultPrevented).toBe(true)
    expect(back).toHaveBeenCalledOnce()
  })

  it('returns from the inner screen only when screens are nested', async () => {
    const outer = vi.fn(), inner = vi.fn()
    await act(async () => root.render(<Panel onBack={outer}><Panel onBack={inner}><p>リスト編集</p></Panel></Panel>))
    const target = container.querySelector('p')!
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 100, 105); touch(target, 'touchend', 150, 105) })
    expect(inner).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
  })

  it('returns from a real friend-list editor to the list without leaving the friends screen', async () => {
    const outer = vi.fn()
    await act(async () => root.render(<Panel onBack={outer}><FriendListsPanel lists={[]} friendIds={[]} friendName={(id) => id} onSave={async () => {}} /></Panel>))
    await act(async () => { container.querySelector<HTMLButtonElement>('.friend-list-create-button')!.click() })
    const heading = container.querySelector('.friend-list-editor-heading h3')!
    await act(async () => { touch(heading, 'touchstart', 25, 100); touch(heading, 'touchmove', 100, 105); touch(heading, 'touchend', 145, 105) })
    expect(container.querySelector('.friend-list-create-button')).not.toBeNull()
    expect(outer).not.toHaveBeenCalled()
  })

  it.each([[35, 220], [-80, 105], [65, 180]])('does not navigate for vertical, leftward, or too-short gestures', async (endX, endY) => {
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><p>本文</p></Panel>))
    const target = container.querySelector('p')!
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', endX, endY); touch(target, 'touchend', endX, endY) })
    expect(back).not.toHaveBeenCalled()
  })

  it('leaves text editing and horizontal carousels to their native gestures', async () => {
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><input /><div style={{ overflowX: 'auto' }}><span>横スクロール</span></div></Panel>))
    const input = container.querySelector('input')!
    const carousel = container.querySelector('div')!
    Object.defineProperties(carousel, { scrollWidth: { value: 300 }, clientWidth: { value: 100 } })
    for (const target of [input, carousel.querySelector('span')!]) {
      await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 110, 100); touch(target, 'touchend', 150, 100) })
    }
    expect(back).not.toHaveBeenCalled()
  })

  it('does not interpret a horizontal back swipe as a downward sheet drag', async () => {
    const back = vi.fn()
    await act(async () => root.render(<MovablePanel onBack={back} />))
    const target = container.querySelector('p')!
    await act(async () => { touch(target, 'touchstart', 20, 100); touch(target, 'touchmove', 120, 112) })
    expect(container.querySelector('section')?.className).not.toContain('dragging')
    await act(async () => { touch(target, 'touchend', 150, 115) })
    expect(back).toHaveBeenCalledOnce()
  })

  it('does not navigate after cancellation or on a screen without a back action', async () => {
    const back = vi.fn()
    await act(async () => root.render(<Panel onBack={back}><p>本文</p></Panel>))
    const target = container.querySelector('p')!
    await act(async () => { touch(target, 'touchstart', 30, 100); touch(target, 'touchmove', 110, 100); touch(target, 'touchcancel', 150, 100); touch(target, 'touchend', 150, 100) })
    expect(back).not.toHaveBeenCalled()
    await act(async () => root.render(<Panel><p>ホーム</p></Panel>))
    const home = container.querySelector('p')!
    await act(async () => { touch(home, 'touchstart', 30, 100); touch(home, 'touchmove', 110, 100); touch(home, 'touchend', 150, 100) })
    expect(back).not.toHaveBeenCalled()
  })
})
