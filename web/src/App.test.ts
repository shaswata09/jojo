import { describe, expect, it } from 'vitest'

/**
 * The route that connects the application record to its container.
 *
 * D20 leaves no way to mount `<App />` and press the button, so this reads the
 * route's source. That is worth doing for one thing only: the record's close
 * affordance is wired from HERE and nowhere else, and the failure it guards
 * against is silent. `ApplicationDetail` falls back to
 * `navigate(applicationsPath())` when no `onClose` arrives, so a missing prop
 * does not crash, does not warn, and closes the record perfectly well — it just
 * drops the query string on the way, and the board comes back with the view,
 * the stage chip and the search box reset. Escape and the sheet's backdrop go
 * through `Applications.tsx`'s `closeDetail`, which carries `location.search`
 * across, so the two ways out of one record disagreed and only one of them
 * looked wrong.
 */
const sources = import.meta.glob('/src/App.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/App.tsx'] ?? ''

/** The JSX element, from `<ApplicationDetail` to its self-closing `/>`. */
const renderSite = /<ApplicationDetail\b[\s\S]*?\/>/.exec(source)?.[0] ?? ''

describe('the application detail route', () => {
  it('renders the detail exactly once', () => {
    expect(source.match(/<ApplicationDetail\b/g)).toHaveLength(1)
    expect(renderSite).not.toBe('')
  })

  it('hands the record a close of its own', () => {
    expect(renderSite).toContain('onClose=')
  })

  it('carries the query string across, so closing keeps the filters', () => {
    // `search` comes from `useLocation`, and it has to reach the navigation —
    // an `onClose` that navigated to a bare path would pass the check above
    // while restoring exactly the bug it was added for.
    expect(source).toContain('useLocation()')
    // Either spelling of the same thing: the destructured `search`, or
    // `location.search` off the whole object. Pinned loosely on purpose —
    // measured, the tighter regex that only accepted the shorthand failed on a
    // rename to `const location = useLocation()` that changed no behaviour at
    // all, and a test that cries on a correct refactor is a test the next
    // person deletes. What it still refuses is the bug: a bare
    // `navigate(applicationsPath())`, or a `search: ''` that is not read from
    // the location.
    expect(source).toMatch(
      /navigate\(\{\s*pathname: applicationsPath\(\),\s*search(\s*:\s*[A-Za-z_$][\w$]*\.search)?\s*,?\s*\}\)/,
    )
  })
})
