// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseDetail } from './CourseDetail'
import { sampleCourses } from '../data/courses'

vi.mock('../lib/firebase', () => ({ subscribeLiveRoadInfo: () => () => {} }))
vi.mock('../lib/liveWeather', () => ({ fetchCurrentWeather: async () => null }))
vi.mock('../lib/liveRoadTraffic', () => ({ fetchCurrentRoadTraffic: async () => null }))

function touch(target: Element, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const point = { identifier: 1, clientX: x, clientY: 500 }
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] },
    changedTouches: { value: [point] },
  })
  target.dispatchEvent(event)
}

describe('course detail back animation', () => {
  let container: HTMLDivElement
  let root: Root
  const back = vi.fn()
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
    back.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const noop = () => {}
    await act(async () => root.render(<CourseDetail course={sampleCourses[0]} onBack={back}
      onClose={noop} onRate={noop} onShare={noop} onOpen3d={noop} onReportToll={noop}
      onReportRoad={noop} onCommunity={noop} canManageCourse={false} onManageCourse={noop} />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('slides the navigation footer and body together before returning', async () => {
    const content = container.querySelector<HTMLElement>('.detail-content')!
    const footer = container.querySelector('footer.nav-actions')!
    const target = footer.querySelector('a')!
    expect(content.contains(footer)).toBe(true)
    expect(content.contains(container.querySelector('.detail-scroll'))).toBe(true)
    await act(async () => { touch(target, 'touchstart', 30); touch(target, 'touchmove', 110) })
    expect(content.style.translate).toBe('80px 0px')
    expect(container.querySelector<HTMLElement>('.detail-panel')!.style.translate).toBe('')
    await act(async () => { touch(target, 'touchend', 130) })
    expect(content.style.translate).toBe('100% 0px')
    expect(back).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(back).toHaveBeenCalledOnce()
  })

  it('restores both areas when the footer swipe is cancelled', async () => {
    const target = container.querySelector('.nav-actions a')!
    const content = container.querySelector<HTMLElement>('.detail-content')!
    await act(async () => { touch(target, 'touchstart', 30); touch(target, 'touchmove', 65); touch(target, 'touchend', 65) })
    expect(content.style.translate).toBe('0px 0px')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(content.style.translate).toBe('')
    expect(back).not.toHaveBeenCalled()
    expect(target.getAttribute('href')).toContain('google.com/maps/dir/')
  })
})
