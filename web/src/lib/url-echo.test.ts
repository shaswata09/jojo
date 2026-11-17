import { describe, expect, it } from 'vitest'
import { urlEcho } from './url-echo'

describe('a search box writing the URL behind itself', () => {
  it('recognises its own write coming back', () => {
    const echo = urlEcho()
    echo.sent('pos')
    expect(echo.isEcho('pos')).toBe(true)
  })

  it('does not adopt an older write that lands after the box moved on', () => {
    // Typed "po", then "pos" before the first write committed: the URL reads
    // "po" for a moment, and adopting it would drop the "s".
    const echo = urlEcho()
    echo.sent('po')
    echo.sent('pos')
    expect(echo.isEcho('po')).toBe(true)
    expect(echo.isEcho('pos')).toBe(true)
  })

  it('adopts a change from outside — Back, or Clear filters', () => {
    const echo = urlEcho()
    echo.sent('pos')
    expect(echo.isEcho('')).toBe(false)
    // and what was pending is forgotten, so a later "pos" is outside news too
    expect(echo.isEcho('pos')).toBe(false)
  })

  it('treats a value it never sent as outside, from the start', () => {
    expect(urlEcho().isEcho('offer')).toBe(false)
  })
})
