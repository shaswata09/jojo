import { Outlet } from 'react-router'
import { GuideNav, GuidePager } from '@/components/guide/GuideNav'
import { useTitle } from '@/lib/links'

/**
 * The guide's layout: a rail above, a pager below, the open page between.
 *
 * A layout route rather than four unrelated pages, because a documentation
 * section is a shape and not a list of URLs — the rail says how many pages
 * there are and which one you are on, and the pager says what comes next. Both
 * are rendered here rather than by each page for the same reason: a pager one
 * author forgets to add is a dead end in the middle of a sequence, and nothing
 * about the content above it decides what follows it.
 *
 * `useTitle(null)` — the child names the tab. A parent that rendered a child
 * route inside itself and also named the tab would win the race, because
 * effects run child-first and the parent's would land last; the four pages
 * would then all be called "How to use" in a background tab, which is the exact
 * problem `useTitle` was added to solve.
 *
 * No <h1> here either. Each page carries its own, so the section has exactly
 * one heading per route rather than a section title stacked on a page title.
 */
export function Guide() {
  useTitle(null)

  return (
    <>
      <GuideNav />
      <Outlet />
      <GuidePager />
    </>
  )
}
