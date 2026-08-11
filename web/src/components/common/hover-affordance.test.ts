import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

/**
 * `hover:text-accent` is not an affordance in the dark theme.
 *
 * `--accent` and `--text-1` are the same `#fafafa` there — shadcn's primary is
 * monochrome and inverts to near-white — so a control already painted
 * `--text-1` that hovers to `--accent` changes nothing at all. Driven in Chrome
 * with a real mouse and a whole-document computed-style diff, six list and card
 * titles came back with not one property changed anywhere on the page, leaving
 * `cursor: pointer` as the only sign they could be clicked. The same six are
 * fine in light, where the two tokens differ, which is why this survived
 * review: it bites only the users whose OS is dark.
 *
 * The measurement matters as much as the finding. Three further sites reported
 * as dead were alive, because their affordance lives on a sibling or a parent —
 * a drag grip fading in, a wrapping `<Link>` underlining. Reading the hovered
 * element's own `color` finds those and calls them broken. So this test does
 * not try to decide which controls are alive; it fixes the six that were
 * measured dead and asserts they keep a second, colour-independent cue.
 */

const sources = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * The controls whose hover was measured dead in dark, and nothing else.
 *
 * Every `hover:text-accent` in each of these files has to carry a second
 * `hover:` utility. `group-hover:text-accent` is not included by the match
 * below and should not be: that spelling says outright that the affordance is
 * coordinated by an ancestor, and in `GlancePanel` the ancestor `<Link>` is
 * what underlines.
 */
const MEASURED_DEAD = [
  'dashboard/GlancePanel.tsx',
  'dashboard/OwedThisWeek.tsx',
  'vault/files/FileRow.tsx',
  'vault/links/LinkRow.tsx',
  'vault/reminders/ReminderRow.tsx',
  'vault/snippets/SnippetCard.tsx',
]

function sourceOf(file: string): string {
  const found = Object.entries(sources).find(([path]) => path.endsWith(`/${file}`))
  expect(found, `no source globbed for ${file}`).toBeDefined()
  return found![1]
}

/**
 * Every quoted run that sits entirely on one line, which is what a class list
 * is here — prettier keeps `className` strings unbroken.
 *
 * Scanning line by line rather than lexing the file matters: an apostrophe in a
 * prose comment ("the row's title") opens a string as far as a whole-file regex
 * is concerned, and everything after it parses one quote out of phase. The
 * first version of this test did exactly that and reported three of six
 * offenders, which is the most dangerous number a regression test can report.
 */
function classLists(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line) => [...line.matchAll(/(['"`])([^'"`\n]*)\1/g)].map((m) => m[2]!))
}

/** The value of a custom property inside one `{ … }` block of the stylesheet. */
function tokenIn(block: string, name: string): string | null {
  const found = new RegExp(`(?:^|[{;\\s])${name}\\s*:\\s*([^;]+);`).exec(block)
  return found ? found[1]!.trim() : null
}

function darkPalette(): string {
  // Comments stripped first. The prose in this stylesheet quotes token names
  // followed by a colon often enough that reading declarations without doing
  // this returns a sentence where a colour should be.
  const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf("html[data-theme='dark']")
  expect(start).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('\n}', start))
}

describe('hover affordances that a token collision would silence', () => {
  it('still has the collision this is guarding against', () => {
    // Stated as a fact about the stylesheet rather than assumed, so that the
    // day somebody separates the two tokens, this test says so instead of
    // going on quietly protecting a problem that no longer exists.
    const dark = darkPalette()
    expect(tokenIn(dark, '--accent')).toBe(tokenIn(dark, '--text-1'))
  })

  it('never leaves hover:text-accent as the only cue on the six measured dead', () => {
    const offenders: string[] = []
    for (const file of MEASURED_DEAD) {
      for (const literal of classLists(sourceOf(file))) {
        if (!/(^|\s)hover:text-accent(\s|$)/.test(literal)) continue
        const otherHover = literal
          .split(/\s+/)
          .some((token) => token.startsWith('hover:') && token !== 'hover:text-accent')
        if (!otherHover) offenders.push(`${file}: ${literal}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is looking at class lists that actually contain the utility', () => {
    // Guards the guard: a regex that matched nothing would make the assertion
    // above vacuous, and a vacuous regression test is worse than none because
    // it is counted as protection.
    const seen = MEASURED_DEAD.filter((file) =>
      classLists(sourceOf(file)).some((literal) => /(^|\s)hover:text-accent(\s|$)/.test(literal)),
    )
    expect(seen).toEqual(MEASURED_DEAD)
  })
})
