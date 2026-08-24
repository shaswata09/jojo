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
 * `links.ts` is the only place the section's shape is declared: adding a fifth
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

const META: Record<GuidePage, Omit<GuidePageMeta, 'id'>> = {
  overview: {
    label: 'How to use',
    blurb:
      'What a record is, where it is kept, what that costs you, and the few keys worth knowing before you trust a job search to it.',
  },
  screens: {
    label: 'Every screen',
    blurb:
      'Each page in turn — what it is for, the mechanics that are not obvious from looking, and what is not connected yet.',
  },
  tools: {
    label: 'The tools',
    blurb:
      'What the assistant can actually do, how it is stopped from doing anything else, and how it picks the right one out of eighty-two.',
  },
  graph: {
    label: 'The graph',
    blurb:
      'What the Graph page draws, how a question becomes a query, and the record model the whole app is stored as.',
  },
  'built-with': {
    label: 'Built with',
    blurb:
      'The open-source work jojo is made of, the licences that cover it, and how the code is arranged.',
  },
}

export const GUIDE_PAGE_META: readonly GuidePageMeta[] = GUIDE_PAGES.map((id) => ({
  id,
  ...META[id],
}))
