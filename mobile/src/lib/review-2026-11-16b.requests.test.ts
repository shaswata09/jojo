/**
 * The 2026-11-16 review's second round, the phone's half (mobile-2..6, perf-4,
 * i18n-6). Pure decisions are run; the wiring in files that import React Native
 * — which this runner does not load (see vitest.config.mts) — is read as text
 * with comments removed, one assertion per line a refactor would have to keep.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STAGES } from '@jojo/service/data/seed'
import messagesEn from '@/i18n/locales/en/messages.json'
import { columnAt, fromStartEdge, startOffset } from '@/lib/board-drop'
import { acceptsCapture, captureScript, newCaptureNonce } from '@/lib/capture-script'
import { keyboardOverlap } from '@/lib/keyboard-overlap'
import { startInset, tabSlot } from '@/components/tour/tour-logic'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) =>
  readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Retry on the receive panel after a decline or a failure (mobile-2)', () => {
  it('clears the old message before scanning again, so the new code can show', () => {
    expect(read('components/transfer/ReceivePanel.tsx')).toMatch(
      /const start = useCallback\(async \(\) => \{\s*setFailed\(null\)\s*setLanded\(null\)\s*setBytes\(0\)/,
    )
  })
})

describe('the keyboard on Android under edge-to-edge (mobile-3)', () => {
  it('measures how much of a view the keyboard covers, in window coordinates', () => {
    // A sheet filling an 800dp screen, keyboard top at 500: 300dp covered.
    expect(keyboardOverlap(0, 800, 500)).toBe(300)
    // A screen under a 56dp header: its bottom edge is still the screen's.
    expect(keyboardOverlap(56, 744, 500)).toBe(300)
    // Ending above the keyboard: nothing to avoid.
    expect(keyboardOverlap(0, 400, 500)).toBe(0)
    expect(keyboardOverlap(0, Number.NaN, 500)).toBe(0)
  })

  it('lifts every sheet on both platforms, not on iOS alone', () => {
    const sheet = read('components/ui/Sheet.tsx')
    expect(sheet).not.toMatch(/Platform\.OS === 'ios' \? 'padding' : undefined/)
    expect(sheet).toMatch(/const keyboard = useKeyboardOverlap\(\)/)
    expect(sheet).toMatch(/paddingBottom: keyboard\.overlap/)
  })

  it('lifts the Assistant composer', () => {
    const screen = read('screens/AssistantScreen.tsx')
    expect(screen).toMatch(/const keyboard = useKeyboardOverlap\(\)/)
    expect(screen).toMatch(/paddingBottom: keyboard\.overlap/)
  })

  it('goes back to zero when the keyboard closes', () => {
    expect(read('lib/use-keyboard-overlap.ts')).toMatch(
      /'keyboardWillHide' : 'keyboardDidHide', \(\) => \{\s*top\.current = null\s*setOverlap\(0\)/,
    )
  })
})

describe('the board in a right-to-left language (mobile-4)', () => {
  const N = STAGES.length
  const STRIDE = 260
  const viewport = { x: 16, width: 360 }
  const content = N * STRIDE

  it('names the same column in LTR as before', () => {
    // 30dp into the viewport, scrolled by one column: the second column.
    const at = fromStartEdge(viewport.x + 30, viewport.x, viewport.width, false)
    expect(columnAt(at, STRIDE, STRIDE, N)).toBe(1)
  })

  it('counts from the right in RTL, where the first stage is drawn', () => {
    // A finger near the RIGHT edge, unscrolled, is over STAGES[0] — not the last.
    const at = fromStartEdge(viewport.x + viewport.width - 10, viewport.x, viewport.width, true)
    expect(columnAt(at, startOffset(0, true, false, content, viewport.width), STRIDE, N)).toBe(0)
  })

  it('reads Android’s physical RTL scroll offset from the start edge', () => {
    // Android starts an RTL scroller at its maximum physical offset, which is
    // zero from the start edge; iOS already reports from the start edge.
    const max = content - viewport.width
    expect(startOffset(max, true, true, content, viewport.width)).toBe(0)
    expect(startOffset(0, true, true, content, viewport.width)).toBe(max)
    expect(startOffset(120, true, false, content, viewport.width)).toBe(120)
    expect(startOffset(120, false, true, content, viewport.width)).toBe(120)
  })

  it('hit-tests, auto-scrolls and draws the floating card from the start edge', () => {
    const board = read('screens/applications/Board.tsx')
    expect(board).toMatch(/const RTL = I18nManager\.isRTL/)
    expect(board).toMatch(/const idx = columnAt\(\s*fromStartEdge\(e\.absoluteX/)
    expect(board).toMatch(/const local = fromStartEdge\(pointerX\.value, wrapX\.value/)
    expect(board).toMatch(/RTL\s*\?\s*\{ end: pointerX\.value - wrapX\.value - grabX\.value \}/)
  })
})

describe('the guided tour in a right-to-left language (mobile-5)', () => {
  it('turns a physical x into the start inset React Native expects', () => {
    expect(startInset(40, 100, 400, false)).toBe(40)
    // In RTL `left` is measured from the right edge.
    expect(startInset(40, 100, 400, true)).toBe(260)
  })

  it('finds a tab in the mirrored bar', () => {
    const bar = { x: 0, y: 740, width: 400, height: 60 }
    expect(tabSlot(bar, 'Today', true)!.x).toBe(320)
    expect(tabSlot(bar, 'More', true)!.x).toBe(0)
  })

  it('places the hole, its shields and the card through the start inset', () => {
    const overlay = read('components/tour/TourOverlay.tsx')
    expect(overlay).toMatch(/left: leftOf\(b\.x, b\.width\)/)
    expect(overlay).toMatch(/left: leftOf\(lit\.x, lit\.width\)/)
    expect(overlay).toMatch(/left: leftOf\(place\.left, cardWidth\)/)
    expect(overlay).toMatch(/tabSlot\(local, tab, I18nManager\.isRTL\)/)
  })
})

describe('the posting browser takes only the capture it asked for (mobile-6)', () => {
  it('accepts the reply that carries the pending token, and nothing else', () => {
    expect(acceptsCapture({ nonce: 'abc' }, 'abc')).toBe(true)
    expect(acceptsCapture({ nonce: 'abc' }, null)).toBe(false)
    expect(acceptsCapture({ nonce: 'abd' }, 'abc')).toBe(false)
    expect(acceptsCapture({}, 'abc')).toBe(false)
    expect(acceptsCapture({ nonce: '' }, '')).toBe(false)
  })

  it('mints a different token every time', () => {
    expect(newCaptureNonce()).not.toBe(newCaptureNonce())
  })

  it('sends the token back with both the capture and the failure', () => {
    const script = captureScript('n0nce-1')
    expect(script).toContain('var NONCE = "n0nce-1";')
    expect(script).toMatch(/type: 'jojo:capture',\s*nonce: NONCE,/)
    expect(script).toMatch(/type: 'jojo:capture-failed',\s*nonce: "n0nce-1",/)
  })

  it('checks the token before fetching or filing anything', () => {
    const screen = read('screens/PostingBrowserScreen.tsx')
    const gate = screen.indexOf('if (!acceptsCapture(raw, pending.current)) return')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(screen.indexOf('await inlineCapture(raw, now()'))
    expect(screen).toMatch(
      /pending\.current = nonce[\s\S]*injectJavaScript\(captureScript\(nonce\)\)/,
    )
  })
})

describe('search on a short query (perf-4)', () => {
  const search = read('screens/SearchScreen.tsx')

  it('groups by pushing, not by copying the group for every row', () => {
    expect(search).not.toMatch(/\[\.\.\.\(map\.get\(r\.group\) \?\? \[\]\), r\]/)
    expect(search).toMatch(/if \(rows\) rows\.push\(r\)/)
  })

  it('draws a capped number of rows per group until asked for the rest', () => {
    expect(search).toMatch(/rows\.slice\(0, GROUP_ROWS\)/)
    expect(search).toMatch(/t\('search\.showAll', \{ count: rows\.length \}\)/)
  })
})

describe('the English pattern sentence (i18n-6)', () => {
  it('says "an application" and "an employer"', () => {
    const end = messagesEn.graph.pattern.endType as Record<string, string>
    expect(end.application).toBe('an application')
    expect(end.org).toBe('an employer')
  })
})

describe('plural rules on Hermes (mobile-1)', () => {
  it('are installed by the polyfills index.ts imports before the app', () => {
    expect(read('lib/polyfills.ts')).toMatch(/installPluralRules\(\)/)
    const entry = readFileSync(path.join(SRC, '..', 'index.ts'), 'utf8')
    expect(entry.indexOf("import '@/lib/polyfills'")).toBeLessThan(
      entry.indexOf("import App from './App'"),
    )
  })
})
