import { PageHeader } from '@/components/common/PageHeader'
import { ApplicationsScreen } from '@/components/guide/screens/ApplicationsScreen'
import { DoorsSection } from '@/components/guide/screens/DoorsSection'
import { OnThisPage } from '@/components/guide/OnThisPage'
import { SECTIONS } from '@/components/guide/screens/sections'
import {
  CalendarScreen,
  ScoutScreen,
  StatisticsScreen,
  TodayScreen,
  VaultScreen,
} from '@/components/guide/screens/SidebarScreens'
import { GraphScreen, TransferScreen } from '@/components/guide/screens/TileScreens'
import {
  AssistantScreen,
  GuideScreen,
  ProfileScreen,
  SettingsScreen,
} from '@/components/guide/screens/TopBarScreens'
import { useTitle } from '@/lib/links'

/**
 * Page 2 — reference, one section per screen.
 *
 * Deliberately one long page with anchored sections rather than thirteen short
 * ones: eleven of the thirteen routes need about four paragraphs, and eleven
 * four-paragraph pages is a navigation problem rather than documentation. The
 * "not connected yet" blocks are meant to read as a repeating pattern — a
 * reader who has seen three of them starts trusting the ones they have not.
 *
 * What this page does NOT do is re-explain the landing page. The record model,
 * the getting-started checklist, the three keyboard doors and the storage story
 * are page 1's, and they are linked to rather than summarised: two accounts of
 * the same mechanism in one section is how a guide starts contradicting itself
 * one edit later.
 *
 * The sections are grouped into files by the argument the `Doors` diagram makes
 * — the six in the sidebar, the two behind its tiles, the four in the top bar —
 * because "which cluster is that page in" is the question this page exists to
 * answer, and it is the one seam a reader and a debugger already share. Every
 * section's `id` comes from `screens/sections.ts`, which is also what the jump
 * list reads.
 */
export function GuideScreens() {
  useTitle('Every screen')

  return (
    <>
      <PageHeader
        title="Every screen, and what it will and will not do"
        subtitle="One section per page — what it is for, what is not obvious, and what is not connected yet."
      />

      <OnThisPage sections={SECTIONS} caption="Thirteen sections — jump to the one you came for" />

      <DoorsSection />

      <TodayScreen />
      <ApplicationsScreen />
      <CalendarScreen />
      <VaultScreen />
      <ScoutScreen />
      <StatisticsScreen />

      <GraphScreen />
      <TransferScreen />

      <ProfileScreen />
      <AssistantScreen />
      <SettingsScreen />
      <GuideScreen />
    </>
  )
}
