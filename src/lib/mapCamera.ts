export interface RectLike {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface CameraPadding {
  top: number
  right: number
  bottom: number
  left: number
}

// MapLibre refuses fitBounds when padding leaves only a very thin strip of
// canvas. A detail sheet can cover most of a phone screen, so retain a real
// viewport rather than merely the minimum needed to avoid a zero-sized box.
const MIN_VISIBLE_MAP_SIZE = 180

/**
 * Returns the part of the map hidden by bottom sheets at their current,
 * transformed position. Keeping this calculation here makes every camera
 * action use the same visible viewport instead of hard-coded offsets.
 */
export function bottomSheetInset(mapRect: RectLike, sheetRects: RectLike[]) {
  return sheetRects.reduce((largest, sheet) => {
    const overlapsHorizontally = sheet.right > mapRect.left && sheet.left < mapRect.right
    const overlapsVertically = sheet.bottom > mapRect.top && sheet.top < mapRect.bottom
    // A small safe-area/footer gap is common on mobile sheets.
    const reachesBottom = sheet.bottom >= mapRect.bottom - 16
    if (!overlapsHorizontally || !overlapsVertically || !reachesBottom) return largest
    return Math.max(largest, mapRect.bottom - Math.max(mapRect.top, sheet.top))
  }, 0)
}

function clampPaddingPair(first: number, second: number, available: number) {
  const total = first + second
  if (total <= available || total === 0) return [first, second] as const
  const scale = available / total
  return [first * scale, second * scale] as const
}

export function mergeCameraPadding(mapRect: RectLike, bottomInset: number, base: Partial<CameraPadding> = {}): CameraPadding {
  const requested = {
    top: Math.max(0, base.top ?? 0),
    right: Math.max(0, base.right ?? 0),
    bottom: Math.max(0, base.bottom ?? 0) + Math.max(0, bottomInset),
    left: Math.max(0, base.left ?? 0),
  }
  const [top, bottom] = clampPaddingPair(requested.top, requested.bottom, Math.max(0, mapRect.height - MIN_VISIBLE_MAP_SIZE))
  const [left, right] = clampPaddingPair(requested.left, requested.right, Math.max(0, mapRect.width - MIN_VISIBLE_MAP_SIZE))
  return { top, right, bottom, left }
}

function activeBottomSheetRects() {
  return [...document.querySelectorAll<HTMLElement>('[data-map-occlusion="bottom-sheet"]')]
    .filter((element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    })
    .map((element) => element.getBoundingClientRect())
}

/**
 * The canonical padding for map camera operations. New features that call
 * flyTo/easeTo/fitBounds should always obtain their padding through here.
 */
export function visibleMapCameraPadding(container: HTMLElement, base: Partial<CameraPadding> = {}): CameraPadding {
  const mapRect = container.getBoundingClientRect()
  const compact = window.matchMedia('(max-width: 760px)').matches
  const inset = compact ? bottomSheetInset(mapRect, activeBottomSheetRects()) : 0
  return mergeCameraPadding(mapRect, inset, base)
}
