import { i18next } from '@/i18n/i18n'
import { GUIDE_PAGES, type GuidePage } from '@/lib/links'

/**
 * What the guide's rail, pager and contents list call each page.
 *
 * Navigation copy only. A label is a pill three words wide; a page's <h1> is
 * allowed to be longer and more specific — "Every screen" fits the rail, "Every
 * screen, and what it will and will not do" does not. What is not allowed is
 * for the two to describe different subjects: if a page's heading changes what
 * it is about, this label is the thing that has gone stale, and it is fixed
 * here rather than by widening the rail.
 *
 * Keyed by page id rather than written out as an array, so the id list in
 * `links.ts` is the only place the section's shape is declared: adding a sixth
 * page there fails to compile until it has a label here, and the order below is
 * whatever order the URLs are in rather than a second copy of it that can
 * disagree.
 */
export type GuidePageMeta = {
  id: GuidePage
  /** Rail pill and pager link. Short enough to sit beside three others at 390px. */
  label: string
  /** One line, on the contents list — what question this page answers. */
  blurb: string
}

/**
 * The catalog key each page's label and blurb sit under, in the `guide`
 * namespace. A key rather than the words, because a table built when this module
 * is imported would be frozen in whatever language was showing then.
 */
const KEY: Record<GuidePage, string> = {
  overview: 'overview',
  screens: 'screens',
  tools: 'tools',
  graph: 'graph',
  'built-with': 'builtWith',
  'control-flow': 'controlFlow',
  licence: 'licence',
}

/**
 * Getters, so each read is translated at the moment it is made: a component
 * that calls `useTranslation` re-renders on a language change and reads the new
 * words, where a value copied out at import time would stay English.
 */
export const GUIDE_PAGE_META: readonly GuidePageMeta[] = GUIDE_PAGES.map((id) => ({
  id,
  get label() {
    return i18next.t(`guide:pages.${KEY[id]}.label`)
  },
  get blurb() {
    return i18next.t(`guide:pages.${KEY[id]}.blurb`)
  },
}))
