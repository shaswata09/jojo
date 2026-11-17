import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel } from '@/components/common/Panel'
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
      {/* The pages are lazy (App.tsx), so the boundary is here, between the
          rail and the pager: those stay on screen while a page's chunk lands. */}
      <Suspense fallback={<GuidePageFallback />}>
        <Outlet />
      </Suspense>
      <GuidePager />
    </>
  )
}

/** What stands where a guide page is while its chunk is in flight. */
function GuidePageFallback() {
  const { t } = useTranslation('pages')
  return (
    <Panel>
      <p className="flex items-center gap-2.5 text-sm text-text-2">
        <Loader
          className="size-4 shrink-0 animate-spin text-text-3"
          strokeWidth={1.8}
          aria-hidden
        />
        {t('routeFallback.loading')}
      </p>
    </Panel>
  )
}
