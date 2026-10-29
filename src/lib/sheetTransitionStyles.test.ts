import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('background sheet transitions', () => {
  it('hides sheets covered by detail without moving them offscreen', () => {
    const rule = styles.match(/:is\(\.explore-panel,\s*\.course-form\)\.covered-by-detail\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule![1]).toMatch(/visibility:\s*hidden/)
    expect(rule![1]).not.toMatch(/transform\s*:/)
  })

  it('keeps navigation surfaces on shared middle and full heights', () => {
    expect(styles).toMatch(/:is\(\.explore-panel, \.detail-panel, \.course-form\)\.mobile-sheet:not\(\.expanded\):not\(\.collapsed\),\s*\.modal-backdrop > \.modal\.mobile-sheet:not\(\.expanded\):not\(\.collapsed\)\s*\{[^}]*height:\s*calc\(\(100dvh - 66px\) \* \.68\)/)
    expect(styles).toMatch(/\.modal-backdrop > \.modal\.mobile-sheet\.expanded\s*\{[^}]*height:\s*calc\(100dvh - 76px\)/)
  })
})
