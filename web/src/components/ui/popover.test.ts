import { describe, expect, it } from 'vitest'
import { popoverLabelling } from './popover'
import popoverSource from './popover.tsx?raw'

const sources = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Every popover is a `role="dialog"`, and dialogs are supposed to have names.
 *
 * Radix stamps the role and supplies no name; the accessibility tree read
 * `role = dialog | name = ""` at all nineteen `<PopoverContent>` call sites,
 * none of which passed an `aria-label`. The panel is now named after the
 * control that opened it, which is the only version of this fix that does not
 * depend on the twentieth call site remembering something the first nineteen
 * forgot.
 *
 * `popoverLabelling` is the whole of the decision, which is why it is a
 * function and not three lines inside the component: nothing here can be
 * mounted in a test (D20 — no jsdom, no testing-library, no component tests),
 * so a rule that lives only inside JSX is a rule nothing checks.
 */
describe('popoverLabelling', () => {
  it('names the panel after the trigger when the call site says nothing', () => {
    expect(popoverLabelling('trigger-7', {})).toEqual({ 'aria-labelledby': 'trigger-7' })
  })

  it('leaves an explicit aria-label alone', () => {
    // Overriding would have quietly renamed any panel somebody had already
    // named by hand, and there is no louder failure than an accessible name
    // that used to be right.
    expect(popoverLabelling('trigger-7', { ariaLabel: 'Snooze until' })).toEqual({
      'aria-label': 'Snooze until',
    })
  })

  it('leaves an explicit aria-labelledby alone', () => {
    expect(popoverLabelling('trigger-7', { ariaLabelledBy: 'heading-2' })).toEqual({
      'aria-labelledby': 'heading-2',
    })
  })

  it('adds nothing at all when no trigger rendered', () => {
    // A `Popover` driven from an anchor has no trigger to borrow a name from.
    // Pointing `aria-labelledby` at an id that is not in the document computes
    // to the same empty name as before, with a dangling reference on top.
    expect(popoverLabelling(null, {})).toEqual({})
  })
})

describe('popover.tsx', () => {
  /**
   * The rule above is only worth anything if the content actually applies it.
   *
   * Verification caught this test file passing 5/5 with the
   * `{...popoverLabelling(...)}` spread deleted from `PopoverContent` — every
   * popover in the app back to `role = dialog | name = ""`, and nothing red.
   * The earlier revert-proof had deleted `popoverLabelling` itself, which only
   * demonstrated that removing an imported function breaks the import; it never
   * touched the one line that decides whether any panel gets a name. That is the
   * same shape as the `opsFor` gap this audit was run to close: the helper is
   * proven, the call site is assumed.
   *
   * Read out of the source rather than off a rendered element because D20 keeps
   * this suite out of a DOM. Scoped to this one declaration rather than grepped
   * whole-file, so a mention of the helper in a comment elsewhere in the module
   * cannot stand in for the call — the first version of THIS test brace-matched
   * from the declaration's opening brace, which is the destructured parameter
   * list, and asserted against a body that stopped before the JSX.
   */
  it('applies the labelling to the content it names', () => {
    const start = popoverSource.indexOf('function PopoverContent(')
    expect(start).toBeGreaterThan(-1)
    // Top-level declarations in this file each start at column 0.
    const after = popoverSource.indexOf('\nfunction ', start + 1)
    const body = popoverSource.slice(start, after === -1 ? undefined : after)
    expect(body).toContain('PopoverPrimitive.Content')

    expect(body).toMatch(/\{\s*\.\.\.popoverLabelling\(/)
    // Destructured out of the rest so the trailing `{...props}` cannot re-add a
    // raw `aria-label` on top of the resolved one and hand React two spellings
    // of the same attribute.
    expect(body).toMatch(/'aria-label':\s*ariaLabel/)
    expect(body).toMatch(/'aria-labelledby':\s*ariaLabelledBy/)
  })

  it('keeps no naming component that nothing uses', () => {
    // `PopoverHeader`, `PopoverTitle` and `PopoverDescription` existed for
    // exactly the job above, and no file in `src` imported any of them: the
    // gap and the machinery for closing it sat side by side through an audit.
    // Either is defensible on its own. Both together is the state this asserts
    // against — a component exported for naming has to be one somebody names
    // something with.
    const exported = /export\s*{([^}]*)}/.exec(popoverSource)
    const names = (exported?.[1] ?? '').split(',').map((n) => n.trim())
    expect(names).toContain('PopoverContent')

    // Matched on the basename: `import.meta.glob` normalises keys to the
    // shortest relative form, so this module and its test arrive as
    // `./popover.tsx` and `./popover.test.ts` and a longer suffix excludes
    // neither. The first version of this test missed that and counted
    // `popover.tsx` as a consumer of its own exports, which made it pass
    // against the very code it was written to reject.
    const elsewhere = Object.entries(sources).filter(
      ([file]) => !/\/popover\.(tsx|test\.ts)$/.test(file),
    )
    const unused = ['PopoverHeader', 'PopoverTitle', 'PopoverDescription'].filter(
      (name) =>
        names.includes(name) &&
        !elsewhere.some(([, source]) => new RegExp(`\\b${name}\\b`).test(source)),
    )
    expect(unused).toEqual([])
  })
})
