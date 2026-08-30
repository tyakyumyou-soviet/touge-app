/** Grow from the anchored bottom edge; never translate a raised sheet. */
export function raisedSheetHeight(startHeight: number, dragY: number, maximumHeight: number) {
  return Math.min(maximumHeight, startHeight + Math.max(0, -dragY))
}

/** Adjacent-only three-step snapping for every bottom sheet. */
export type SheetSnap = 'full' | 'middle' | 'minimized'

export function nextSheetSnap(current: SheetSnap, dragY: number, threshold = 42): SheetSnap {
  if (dragY < -threshold) return current === 'minimized' ? 'middle' : 'full'
  if (dragY > threshold) return current === 'full' ? 'middle' : 'minimized'
  return current
}
