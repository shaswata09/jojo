import { PageHeader } from '@/components/common/PageHeader'
import { GettingStarted } from '@/components/guide/GettingStarted'
import { GuideContents } from '@/components/guide/GuideNav'
import { TourLauncher } from '@/components/guide/GuidedTour'
import {
  GraphSection,
  KeysSection,
  KeywordsSection,
} from '@/components/guide/overview/GettingAround'
import { LadderSection } from '@/components/guide/overview/Ladder'
import { OnThisPage } from '@/components/guide/overview/OnThisPage'
import { TrackApplicationSection } from '@/components/guide/overview/TrackApplication'
import { DatesSection, ProfileSection, VaultSection } from '@/components/guide/overview/WhatYouFile'
import { BrowserIsTheDatabase, DataSection } from '@/components/guide/overview/YourData'
import { useTitle } from '@/lib/links'

/**
 * The landing page of the guide — trust, before anything else.
 *
 * The two capability cards used to open this page and take up a third of it,
 * which meant a first-time reader met two things that do not exist before
 * meeting one that does. They are last now: they are the end of the story, not
 * the beginning of it.
 *
 * Organised by what someone is trying to do rather than by which route a
 * feature lives on. "The Applications page has a board and a table" is a fact
 * the sidebar already gives away; "move an application from applying to an
 * offer, and here is what each move asks you" is the thing they came for. The
 * per-route reference is page 2, and this page links there rather than
 * competing with it.
 *
 * That order is the reason the sections sit in the files they do: what you
 * track, what you file beside it, how you get around it, where it is kept, and
 * what is not connected yet. The `id` on each panel is what the jump list in
 * `overview/OnThisPage.tsx` links to.
 */
export function GuideOverview() {
  useTitle('How to use jojo')

  return (
    <>
      <PageHeader
        title="How to use jojo"
        subtitle="Everything runs on your machine. Start simple, add power when you want it."
      />

      <GuideContents />

      <OnThisPage />

      {/* The tour was written, tested and imported by nothing — a door-less
          room, and a guide that mentioned a tutorial no reader could reach.
          It goes directly under the checklist rather than above it: both are
          ways in, the checklist is the shorter one, and a reader who has just
          answered the first-run question is looking at this part of the page.
          It must be mounted inside the router, which every guide page is, since
          three of its steps hand off to a real route. */}
      <GettingStarted />

      <div className="surface flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg px-4 py-3.5 sm:px-5">
        <p className="min-w-0 flex-1 basis-64 text-sm text-text-2">
          Or be walked through it. Seven steps on the real pages, opening the real controls — the
          tour never types anything for you, never saves a record and never changes a setting.
        </p>
        <TourLauncher className="shrink-0" />
      </div>

      <TrackApplicationSection />

      <DatesSection />
      <VaultSection />
      <ProfileSection />

      <KeysSection />
      <KeywordsSection />
      <GraphSection />

      <DataSection />
      <BrowserIsTheDatabase />

      <LadderSection />
    </>
  )
}
