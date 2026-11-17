import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Screen } from '@/components/ui/Screen'
import { Button } from '@/components/ui/Button'
import { Segment } from '@/components/ui/Segment'
import { GuideBuiltWith } from '@/screens/guide/GuideBuiltWith'
import { GuideGraph } from '@/screens/guide/GuideGraph'
import { GuideOverview } from '@/screens/guide/GuideOverview'
import { GuideScreens } from '@/screens/guide/GuideScreens'
import { GuideTools } from '@/screens/guide/GuideTools'
import { startTour } from '@/components/tour/store'
import { GUIDE_PAGES as PAGES } from '@/navigation/types'
import type { GuidePage as Page, RootStackParamList } from '@/navigation/types'

/**
 * The guide, as a section rather than a page.
 *
 * The web app makes this five routes behind a nav rail — overview, screens,
 * graph, tools, built with — because one page holding all of it scrolls for a
 * minute and nobody reaches the end. The same is true here and more so, so the
 * same five pages exist; what changes is the control. A rail needs a column this
 * layout does not have, so the pages sit behind the segmented control the rest
 * of the app already uses for the Vault's tools and the board's two views.
 *
 * Five is one more than fits a 390pt track, so the control scrolls — the same
 * answer the Vault reached at five tools. A label clipped at the edge is at
 * least a label that says there is more of it; five squeezed onto one line is
 * five that cannot be read.
 *
 * Which page you are on is state, not a route. Deep-linking to a guide page is
 * a thing a URL bar makes worth having and a phone does not — and making it a
 * route would put five more entries in the back stack between a reader and the
 * screen they came from. Search can still open one: a `page` param picks the
 * page on arrival and is cleared, so it is a one-shot instruction.
 *
 * The pages themselves (`GUIDE_PAGES`) live in `navigation/types.ts`, so a
 * search result can name one without importing this screen.
 */

export function GuideScreen() {
  const { t } = useTranslation('guide')
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'Guide'>>()
  const [page, setPage] = useState<Page>(route.params?.page ?? 'overview')
  const linked = route.params?.page
  useEffect(() => {
    if (!linked) return
    setPage(linked)
    navigation.setParams({ page: undefined })
  }, [linked, navigation])
  const options = PAGES.map((value) => ({ value, label: t(`screen.pages.${value}.label`) }))

  return (
    <Screen title={t('screen.title')} subtitle={t(`screen.pages.${page}.subtitle`)}>
      <Segment
        label={t('screen.pageLabel')}
        scroll
        options={options}
        value={page}
        onChange={setPage}
      />

      {/* Above the pages, and on every one of them.
          The tour is offered once during onboarding and then has to live
          somewhere findable, or "you can always take it later" is a promise the
          app does not keep. This is where someone looks for it: the screen
          called How to use. */}
      <Button
        label={t('screen.takeTour')}
        icon="compass"
        variant="outline"
        full
        // Resumes where the reader left off, if they did (`startTour`).
        onPress={() => void startTour()}
      />

      {page === 'overview' ? <GuideOverview /> : null}
      {page === 'screens' ? <GuideScreens /> : null}
      {page === 'graph' ? <GuideGraph /> : null}
      {page === 'tools' ? <GuideTools /> : null}
      {page === 'built' ? <GuideBuiltWith /> : null}
    </Screen>
  )
}
