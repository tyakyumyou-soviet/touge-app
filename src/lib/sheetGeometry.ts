/** Grow from the anchored bottom edge; never translate a raised sheet. */
export function raisedSheetHeight(startHeight: number, dragY: number, maximumHeight: number) {
  return Math.min(maximumHeight, startHeight + Math.max(0, -dragY))
}
