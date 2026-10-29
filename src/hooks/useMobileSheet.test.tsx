// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reopenMobileSheet, useMobileSheet } from './useMobileSheet'

function Sheet({ name, enabled = true }: { name: string; enabled?: boolean }) {
  const sheet = useMobileSheet(enabled, name)
  const [taps, setTaps] = useState(0)
  if (!enabled) return null
  return <section data-sheet={name} className={sheet.className} style={sheet.style}>
    <div className="mobile-sheet-drag-region" {...sheet.dragProps} onClick={sheet.expandOnTap}>{name}</div>
    <div data-sheet-scroll {...sheet.scrollProps}><button onClick={() => setTaps((value) => value + 1)}>プロフィール {taps}</button><p>本文</p></div>
  </section>
}

function touch(element: Element, type: string, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 1, clientX: 80, clientY: y }
  Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] }, changedTouches: { value: [point] } })
  element.dispatchEvent(event)
  return event
}

describe('mobile sheet input ownership', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 283, top: 283, bottom: 683, left: 0, right: 360, width: 360, height: 400, toJSON: () => ({}) })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not let a closed logout dialog take focus away from a visible sheet', async () => {
    await act(async () => root.render(<><Sheet name="一覧" /><Sheet name="ログアウト" enabled={false} /></>))
    expect(container.querySelector('[data-sheet="一覧"]')?.className).not.toContain('sheet-backgrounded')
    expect(container.querySelector('[data-sheet="ログアウト"]')).toBeNull()
  })

  it('restores an already-mounted minimized account sheet on another profile-icon tap', async () => {
    function App() {
      return <><button id="account" onClick={() => reopenMobileSheet('アカウント')}>アカウント</button><Sheet name="アカウント" /></>
    }
    await act(async () => root.render(<App />))
    const header = container.querySelector('.mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchstart', 300); touch(header, 'touchmove', 600) })
    await act(async () => { touch(header, 'touchend', 600) })
    expect(container.querySelector('section')?.className).toContain('collapsed')
    await act(async () => { container.querySelector<HTMLButtonElement>('#account')!.click() })
    expect(container.querySelector('section')?.className).not.toContain('collapsed')
    expect(container.querySelector('section')?.className).not.toContain('sheet-backgrounded')
  })

  it('restores a background panel instead of leaving its existing open flag inert', async () => {
    await act(async () => root.render(<><Sheet name="一覧" /><Sheet name="設定" /></>))
    expect(container.querySelector('[data-sheet="一覧"]')?.className).toContain('sheet-backgrounded')
    await act(async () => reopenMobileSheet('一覧'))
    expect(container.querySelector('[data-sheet="一覧"]')?.className).not.toMatch(/collapsed|sheet-backgrounded/)
    expect(container.querySelector('[data-sheet="設定"]')?.className).toContain('sheet-backgrounded')
  })

  it('keeps the previous sheet expanded while another sheet is open and after returning', async () => {
    await act(async () => root.render(<Sheet name="一覧" />))
    await act(async () => { container.querySelector<HTMLElement>('.mobile-sheet-drag-region')!.click() })
    expect(container.querySelector('[data-sheet="一覧"]')?.className).toContain('expanded')
    await act(async () => root.render(<><Sheet name="一覧" /><Sheet name="詳細" /></>))
    const list = container.querySelector('[data-sheet="一覧"]')!
    expect(container.querySelector('[data-sheet="詳細"]')?.className).toContain('expanded')
    expect(list.className).toContain('expanded')
    expect(list.className).not.toContain('collapsed')
    await act(async () => root.render(<Sheet name="一覧" />))
    expect(list.className).toContain('expanded')
    expect(list.className).not.toMatch(/collapsed|sheet-backgrounded/)
  })

  it('carries a handle adjustment in a detail sheet back to its parent', async () => {
    await act(async () => root.render(<Sheet name="一覧" />))
    await act(async () => { container.querySelector<HTMLElement>('.mobile-sheet-drag-region')!.click() })
    await act(async () => root.render(<><Sheet name="一覧" /><Sheet name="詳細" /></>))
    const header = container.querySelector('[data-sheet="詳細"] .mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchstart', 300); touch(header, 'touchmove', 390); touch(header, 'touchend', 390) })
    expect(container.querySelector('[data-sheet="詳細"]')?.className).not.toMatch(/expanded|collapsed/)
    await act(async () => root.render(<Sheet name="一覧" />))
    expect(container.querySelector('[data-sheet="一覧"]')?.className).not.toMatch(/expanded|collapsed|sheet-backgrounded/)
  })

  it('restores a backgrounded minimized sheet without animating through its compact height', async () => {
    await act(async () => root.render(<Sheet name="一覧" />))
    const header = container.querySelector('.mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchstart', 300); touch(header, 'touchmove', 600); touch(header, 'touchend', 600) })
    await act(async () => root.render(<><Sheet name="一覧" /><Sheet name="詳細" /></>))
    await act(async () => reopenMobileSheet('一覧'))
    const list = container.querySelector('[data-sheet="一覧"]')!
    expect(list.className).not.toMatch(/collapsed|sheet-backgrounded/)
    expect(list.className).toContain('sheet-restoring')
    await act(async () => { vi.advanceTimersByTime(32) })
    expect(list.className).not.toContain('sheet-restoring')
  })

  it('reopens a previously minimized dialog after it is disabled and enabled again', async () => {
    function App() {
      const [enabled, setEnabled] = useState(true)
      return <><button id="toggle" onClick={() => setEnabled((value) => !value)}>切替</button><Sheet name="確認" enabled={enabled} /></>
    }
    await act(async () => root.render(<App />))
    const header = container.querySelector('.mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchstart', 300); touch(header, 'touchmove', 600); touch(header, 'touchend', 600) })
    expect(container.querySelector('section')?.className).toContain('collapsed')
    await act(async () => { container.querySelector<HTMLButtonElement>('#toggle')!.click() })
    expect(container.querySelector('section')).toBeNull()
    await act(async () => { container.querySelector<HTMLButtonElement>('#toggle')!.click() })
    expect(container.querySelector('section')?.className).not.toContain('collapsed')
  })

  it('keeps button taps usable despite finger movement in the scroll area', async () => {
    await act(async () => root.render(<Sheet name="アカウント" />))
    const button = container.querySelector('button')!
    let move: Event
    await act(async () => {
      touch(button, 'touchstart', 400)
      move = touch(button, 'touchmove', 415)
      touch(button, 'touchend', 415)
      button.click()
    })
    expect(move!.defaultPrevented).toBe(false)
    expect(button.textContent).toBe('プロフィール 1')
    expect(container.querySelector('section')?.className).not.toContain('dragging')
  })

  it('does not swallow a later header tap after a canceled non-drag touch', async () => {
    await act(async () => root.render(<Sheet name="アカウント" />))
    const header = container.querySelector<HTMLElement>('.mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchcancel', 300); header.click() })
    expect(container.querySelector('section')?.className).toContain('expanded')
  })

  it('cancels pending animation frames at release so the sheet cannot jump back into a drag', async () => {
    await act(async () => root.render(<Sheet name="アカウント" />))
    const header = container.querySelector('.mobile-sheet-drag-region')!
    await act(async () => { touch(header, 'touchstart', 400); touch(header, 'touchmove', 200) })
    await act(async () => { touch(header, 'touchend', 200); vi.runAllTimers() })
    const sheet = container.querySelector<HTMLElement>('section')!
    expect(sheet.className).toContain('expanded')
    expect(sheet.className).not.toContain('dragging')
    expect(sheet.style.height).toBe('')
  })
})
