import { describe, expect, it } from 'vitest'
import { assignCourseColors } from './courseColors'

describe('course colour assignment', () => {
  it('uses different colours for crossing or very close routes', () => {
    const colors = assignCourseColors([
      { id: 'a', route: [[139, 35], [139.02, 35.02]] },
      { id: 'b', route: [[139, 35.02], [139.02, 35]] },
    ])
    expect(colors.get('a')).not.toBe(colors.get('b'))
  })

  it('may reuse a colour for clearly separate routes', () => {
    const colors = assignCourseColors([
      { id: 'a', route: [[139, 35], [139.01, 35.01]] },
      { id: 'b', route: [[138, 34], [138.01, 34.01]] },
    ])
    expect(colors.get('a')).toBe(colors.get('b'))
  })
})
