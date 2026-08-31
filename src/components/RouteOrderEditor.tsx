import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { blockDropBoundary } from '../lib/draftReorder'

export interface RouteOrderBlock { id: string; start: number; count: number; title: string; subtitle: string }

export function RouteOrderEditor({ blocks, onMove }: { blocks: RouteOrderBlock[]; onMove: (from: number, count: number, to: number) => void }) {
  const list = useRef<HTMLOListElement>(null)
  const before = useRef(new Map<string, number>())
  const gesture = useRef<{ id: number; source: RouteOrderBlock; y: number; moved: boolean; target: RouteOrderBlock | null } | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  function move(source: RouteOrderBlock, target: RouteOrderBlock) {
    if (source.id === target.id) return
    before.current = new Map(Array.from(list.current?.children ?? []).map((node) => [(node as HTMLElement).dataset.blockId!, node.getBoundingClientRect().top]))
    onMove(source.start, source.count, blockDropBoundary(source.start, target))
    setAnnouncement(`${source.title}を${target.title}の${target.start > source.start ? '後ろ' : '前'}へ移動しました`)
  }

  useLayoutEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const node of Array.from(list.current?.children ?? [])) {
        const previous = before.current.get((node as HTMLElement).dataset.blockId!)
        if (previous === undefined) continue
        node.getAnimations().forEach((animation) => animation.cancel())
        const delta = previous - node.getBoundingClientRect().top
        if (Math.abs(delta) > 1) node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 200, easing: 'ease-out' })
      }
    }
    before.current.clear()
  }, [blocks])

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    if (Math.abs(event.clientY - active.y) > 5) active.moved = true
    if (!active.moved) return
    const scroll = list.current?.closest<HTMLElement>('[data-sheet-scroll]')
    if (scroll) {
      const bounds = scroll.getBoundingClientRect()
      if (event.clientY < bounds.top + 52) scroll.scrollTop -= 18
      if (event.clientY > bounds.bottom - 52) scroll.scrollTop += 18
    }
    // Pointer capture keeps the gesture alive outside the handle. Hit test rows
    // by their live bounds instead of event.target (which remains the handle).
    const rows = Array.from(list.current?.children ?? [])
    const row = rows.find((node) => { const rect = node.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY <= rect.bottom })
    const target = blocks.find((block) => block.id === (row as HTMLElement | undefined)?.dataset.blockId)
    if (target) { active.target = target; setOver(target.id) }
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    setDragged(null); setOver(null)
    if (!cancelled && active.moved && active.target) move(active.source, active.target)
  }

  if (blocks.length < 2) return null
  return <section className="route-order-editor" aria-label="ルートの順番を変更" data-sheet-no-drag>
    <div><strong>ルートの順番</strong><small>つまみをドラッグして入れ替え</small></div>
    <ol ref={list}>{blocks.map((block, index) => <li key={block.id} data-block-id={block.id} className={`${dragged === block.id ? 'dragging' : ''} ${over === block.id && over !== dragged ? 'drop-target' : ''}`}>
      <button type="button" className="route-drag-handle" aria-label={`${block.title}をドラッグして移動`} onClick={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return
          event.preventDefault(); event.stopPropagation()
          gesture.current = { id: event.pointerId, source: block, y: event.clientY, moved: false, target: null }
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragged(block.id)
        }} onPointerMove={dragMove} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)}>⠿</button>
      <div><strong>{block.title}</strong><small>{block.subtitle}{block.count > 1 ? ` · ${block.count}地点` : ''}</small></div>
      <button type="button" onClick={() => move(block, blocks[index - 1])} disabled={index === 0} aria-label={`${block.title}を前へ`}>↑</button>
      <button type="button" onClick={() => move(block, blocks[index + 1])} disabled={index === blocks.length - 1} aria-label={`${block.title}を後へ`}>↓</button>
    </li>)}</ol><span className="route-order-announcement" role="status">{announcement}</span>
  </section>
}
