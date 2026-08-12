import { useState } from 'react'
import { Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { GuideBuiltWith } from '@/screens/guide/GuideBuiltWith'
import { GuideGraph } from '@/screens/guide/GuideGraph'
import { GuideOverview } from '@/screens/guide/GuideOverview'
import { GuideScreens } from '@/screens/guide/GuideScreens'

/**
 * The guide, as a section rather than a page.
 *
 * The web app makes this four routes behind a nav rail — overview, screens,
 * graph, built with — because one page holding all of it scrolls for a minute
 * and nobody reaches the end. The same is true here and more so, so the same
 * four pages exist; what changes is the control. A rail needs a column this
 * layout does not have, so the pages sit behind the segmented control the rest
 * of the app already uses for the Vault's tools and the board's two views.
 *
 * Which page you are on is state, not a route. Deep-linking to a guide page is
 * a thing a URL bar makes worth having and a phone does not — and making it a
 * route would put four more entries in the back stack between a reader and the
 * screen they came from.
 */

const PAGES = [
  { value: 'overview', label: 'Overview' },
  { value: 'screens', label: 'Screens' },
  { value: 'graph', label: 'Graph' },
  { value: 'built', label: 'Built with' },
] as const

type Page = (typeof PAGES)[number]['value']

const SUBTITLE: Record<Page, string> = {
  overview: 'Everything runs on your device. Start simple, add power when you want it.',
  screens: 'What each screen is for, and a way straight into it.',
  graph: 'The record model underneath the seven lists.',
  built: 'What this is made of, and what is still a placeholder.',
}

export function GuideScreen() {
  const [page, setPage] = useState<Page>('overview')

  return (
    <Screen title="How to use jojo" subtitle={SUBTITLE[page]}>
      <Segment label="Guide page" options={PAGES} value={page} onChange={setPage} />

      {page === 'overview' ? <GuideOverview /> : null}
      {page === 'screens' ? <GuideScreens /> : null}
      {page === 'graph' ? <GuideGraph /> : null}
      {page === 'built' ? <GuideBuiltWith /> : null}
    </Screen>
  )
}
