/**
 * A toast's countdown has to be a countdown.
 *
 * `ToastCard` arms one `setTimeout` in a `useEffect`, and React re-runs an
 * effect whenever any dep fails `Object.is` against the previous render's. The
 * viewport used to build `onDismiss={() => onDismiss(t.id)}` inside its `map`,
 * which is a brand new function every time the STACK renders — so every toast
 * that arrived, and every toast that expired, cleared and re-armed the timer on
 * every card still on screen. Under `TOAST_LIMIT` 3 that means a burst of
 * toasts from one save kept the first card's Undo alive past its eight seconds,
 * and anything arriving faster than that kept it alive indefinitely. An Undo
 * the user has stopped thinking about is worse than no Undo at all.
 *
 * D20 forbids jsdom and testing-library, so nothing here mounts the provider —
 * which is exactly why the defect survived: prop identity is invisible to the
 * compiler and to every test that does not render. What IS assertable is the
 * wiring the source commits to, which is how `web/src/components/ui/popover.
 * test.ts` and `web/src/lib/dialog-mount.test.ts` pin their own call sites.
 *
 * Read with `node:fs` rather than `?raw`: that query is a Vite feature and this
 * workspace has no ambient declaration for it, so it would not typecheck under
 * `tsc --noEmit`. The runner is `environment: 'node'` and this file never ships.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Joined rather than `new URL('./toast.tsx', import.meta.url)`: this workspace
// ships `react-native-url-polyfill` and compiles with `lib: ["ESNext"]`, so the
// global `URL` is not the one `node:fs` accepts and the tidier form fails tsc.
const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'toast.tsx'),
  'utf8',
)

describe('ToastViewport', () => {
  it('hands each card the provider dismiss itself, never a closure over it', () => {
    const cards = [...source.matchAll(/<ToastCard\b([^>]*)\/>/g)].map((m) => m[1])

    // If this ever reads 0 the regex has drifted rather than the wiring being
    // fixed, and an empty loop below would pass while hiding the whole defect.
    expect(cards.length).toBe(1)

    for (const props of cards) {
      expect(props).toContain('onDismiss={onDismiss}')
      // The precise shape that broke it. Any arrow in the map body is rebuilt
      // per render of the stack and lands in the card's dep list.
      expect(props).not.toContain('=>')
    }
  })
})

describe('ToastCard', () => {
  /**
   * The prop TYPE is half the fix. While the card took a bound `() => void`
   * there was nothing the viewport could pass but a closure, so restoring that
   * signature restores the bug no matter how careful the call site is.
   */
  it('takes the id, so the viewport has nothing left to bind', () => {
    const declaration = source.match(/^function ToastCard\(.*$/m)?.[0] ?? ''

    expect(declaration).toContain('onDismiss: (id: string) => void')
  })

  it('arms its timer on deps that no render can rebuild', () => {
    // Anchored on the timer's own teardown, so the provider's two `useCallback`
    // dep lists cannot stand in for the one that matters.
    const lists = [...source.matchAll(/clearTimeout\(timer\)[\s\S]*?\n {2}\}, \[([^\]]*)\]\)/g)]

    // One timer in the file, and the assertions below say nothing at all if
    // this stops finding it.
    expect(lists.length).toBe(1)

    const deps = lists[0][1].split(',').map((dep) => dep.trim())

    // The id is read inside the effect now, which is what lets `onDismiss`
    // travel down unbound.
    expect(deps).toContain('onDismiss')
    expect(deps).toContain('toast.id')

    // Plain identifiers and property reads only. A call, an arrow, an object or
    // an array literal here is a value minted during render, and every one of
    // them restarts the countdown on a toast the user is already reading.
    for (const dep of deps) expect(dep).toMatch(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/)
  })
})
