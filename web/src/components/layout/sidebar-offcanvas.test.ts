/**
 * Nothing in the closed drawer takes Tab.
 *
 * Below `lg` the sidebar is an off-canvas drawer translated a screen-width to
 * the left, and it declares `aria-hidden` while it is there. That declaration
 * was not true of the keyboard: `tabIndex={-1}` was passed to `SidebarNav` and
 * `SidebarRuntime`, and a scan of everything the <aside> renders found three
 * controls it never reached — the close button, the theme toggle and "Poke
 * jojo", the last two inside `BrandCard`, which takes no such prop. Tab landed
 * on all three. Focus off-screen shows no ring, Enter fires something invisible,
 * and the screen reader says nothing about where it is, because the subtree is
 * `aria-hidden`.
 *
 * D20 forbids mounting, so this reads the JSX instead — the same thing
 * `dialog-mount.test.ts` does for the same reason. What it pins is the shape of
 * the guarantee: either the container takes the whole subtree out of reach, or
 * every control in it guards itself. It is deliberately a rule about the
 * subtree and not about three named buttons, because the defect was never those
 * three buttons — it was that adding a fourth needed nobody's permission.
 */
import { describe, expect, it } from 'vitest'
import brandCard from '@/components/brand/BrandCard.tsx?raw'
import sidebar from '@/components/layout/Sidebar.tsx?raw'
import sidebarNav from '@/components/layout/SidebarNav.tsx?raw'
import sidebarRuntime from '@/components/layout/SidebarRuntime.tsx?raw'

/**
 * Comments out, and `=>` masked.
 *
 * Both were false readings in the first draft: a `<select>` named in a comment
 * counted as a control, and an `onClick={() => …}` ended the tag early, hiding
 * the `tabIndex` two lines below it and reporting a guarded button as bare.
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/=>/g, '=~')

/** Only what the <aside> itself renders — the rest of the file is not in it. */
const subtree = (() => {
  const src = strip(sidebar)
  return src.slice(src.indexOf('<aside'), src.lastIndexOf('</aside>'))
})()

/**
 * The opening tag of the <aside>, where the two declarations have to agree.
 *
 * Ends at the first `>` outside a JSX expression — every `>` in the attributes
 * is inside braces, and `strip` has already masked the arrows. Matching a
 * literal indent instead would return -1 the day someone reformats the file,
 * and -1 hands `slice` the whole subtree, at which point every assertion below
 * passes on the wrong text.
 */
const asideTag = (() => {
  let depth = 0
  for (let i = 0; i < subtree.length; i += 1) {
    const ch = subtree[i]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) return subtree.slice(0, i + 1)
  }
  throw new Error('the <aside> opening tag has no end')
})()

/** Everything the drawer puts on screen. `BrandCard` is in it and takes no props. */
const RENDERED: Array<[string, string]> = [
  ['Sidebar', subtree],
  ['BrandCard', strip(brandCard)],
  ['SidebarNav', strip(sidebarNav)],
  ['SidebarRuntime', strip(sidebarRuntime)],
]

/** Tags that take focus with no help from anyone. */
const FOCUSABLE = /<(button|a|NavLink|input|select|textarea)\b([^>]*)>/g

const controls = RENDERED.flatMap(([where, src]) =>
  [...src.matchAll(FOCUSABLE)].map(([, tag, attrs]) => ({
    name: `<${tag}> in ${where}`,
    guarded: /tabIndex/.test(attrs),
  })),
)

const unguarded = controls.filter((c) => !c.guarded).map((c) => c.name)

describe('the off-canvas drawer', () => {
  it('is taken out of reach as a whole, not control by control', () => {
    // `inert` is the container-level version of what `tabIndex={-1}` does one
    // element at a time: focus, clicks and find-in-page all stop at it.
    expect(asideTag).toMatch(/\binert\b/)
  })

  it('gates `inert` on the same predicate as `aria-hidden`', () => {
    // The pair drifting apart IS the bug, in its general form: a subtree that
    // says it is hidden while the keyboard can still walk into it.
    const hidden = /aria-hidden=\{([A-Za-z][\w.]*)\}/.exec(asideTag)?.[1]
    expect(hidden, 'aria-hidden should read a single named predicate').toBeDefined()
    expect(asideTag).toContain(`${hidden ?? '?'} ? { inert: true }`)
  })

  it('leaves nothing focusable that neither it nor the container covers', () => {
    // Either branch is a correct answer; this is the state that is not.
    const covered = /\binert\b/.test(asideTag) || unguarded.length === 0
    expect(covered, `unguarded while hidden: ${unguarded.join(', ')}`).toBe(true)
  })

  it('is reading real controls, so the rule above can fail', () => {
    // A scan that matched nothing would pass every assertion here for the worst
    // possible reason. The drawer holds a close button, a theme toggle, the
    // mascot's hit target, six nav links and three runtime tiles.
    expect(controls.length).toBeGreaterThanOrEqual(5)

    /*
     * That the scan can still SAY "unguarded" is proved against fixtures, not
     * against the live source. The first version asserted at least one real
     * control was still bare, which measured 3 and looked like a fine canary —
     * and it fails the day someone applies the OTHER correct fix. Adding
     * `tabIndex` to the close button and to both of `BrandCard`'s controls made
     * the drawer strictly safer and turned this test red, which is a test
     * holding the codebase at its current state rather than at its rule.
     */
    const guards = (src: string) =>
      [...src.matchAll(FOCUSABLE)].map(([, , attrs]) => /tabIndex/.test(attrs))
    expect(guards('<button onClick={close}>Close navigation</button>')).toEqual([false])
    expect(guards('<button tabIndex={tabIndex} onClick={close}>Close</button>')).toEqual([true])
    // And the tag really is just the tag: if it ran on to the end of the
    // subtree, an `inert` anywhere in the drawer would satisfy the first test.
    expect(asideTag).not.toContain('<BrandCard')
  })
})
