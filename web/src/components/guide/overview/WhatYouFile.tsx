/**
 * The three sections about what you keep alongside an application: its dates,
 * the Vault shelf, and your own profile.
 *
 * Together because they are the same argument three times — one record type
 * with several names, one shelf with five tools, one profile that is a record
 * like any other — and a reader who has the application section has everything
 * needed to read all three.
 */

import { Panel, PanelTitle } from '@/components/common/Panel'
import { Go } from '@/components/guide/overview/Go'
import { calendarPath, dashboardPath, profilePath, vaultPath } from '@/lib/links'

/* --------------------------------- dates ---------------------------------- */

export function DatesSection() {
  return (
    <Panel id="dates" className="scroll-mt-4">
      <PanelTitle hint="one record type, three names">Dates, deadlines and follow-ups</PanelTitle>
      <p className="text-sm text-text-2">
        A submission deadline, an interview, a campus visit and a note to chase someone are the same
        kind of record with a different label on it, and a reminder is that record with a nudge
        switched on. This is the one thing in jojo worth knowing before you use it: add something
        once and it reaches the <Go to={calendarPath()}>calendar</Go>, the week ahead on{' '}
        <Go to={dashboardPath()}>Today</Go> and the application it belongs to at the same time,
        because there is nothing to keep in step.
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The month grid and the day list are one page. Dragging an item onto another day
          reschedules it and offers an Undo in the toast.
        </li>
        <li>
          Colour follows the date and nothing else — overdue, due within 48 hours, done — so nothing
          goes stale by sitting there. The legend is on the page.
        </li>
        <li>
          The month you are looking at, the day you selected and the item you opened are all in the
          URL, so a particular day is linkable.
        </li>
        <li>
          Reminders also have their own list in the{' '}
          <Go to={vaultPath({ tool: 'reminders' })}>Vault</Go>, where ticking them off is the whole
          job. An overdue one stays flagged on Today until it is ticked.
        </li>
        <li>
          Moving an application to Interview or Offer offers to mint the date for you, so the round
          you just scheduled does not need entering twice.
        </li>
      </ul>
    </Panel>
  )
}

/* --------------------------------- vault ---------------------------------- */

export function VaultSection() {
  return (
    <Panel id="vault" className="scroll-mt-4">
      <PanelTitle hint="five tools, one shelf">File what you will need again</PanelTitle>
      <dl className="divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 first:pt-0">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'reminders' })}>Reminders</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Everything with a nudge on it, in one list, with the overdue ones first.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'links' })}>Links</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Portals, funding pages, people worth remembering. Each goes in a bucket, and you can
            move it to another one later.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'files' })}>Files</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            The name, size and type of a document are recorded.{' '}
            <span className="text-text-1">The document itself is not</span> — jojo has nowhere on
            your disk to put it. A file you pick during this visit previews until you reload; after
            that the row is a record that the document exists, which is enough to know what you sent
            and when.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'snippets' })}>Snippets</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Paragraphs you keep rewriting. The <span className="text-text-1">Draft a message</span>{' '}
            dialog is built out of these with the role, employer and dates filled in from the record
            — a person&rsquo;s name is never filled in for you, because guessing one is how a
            message goes out addressed to the wrong human.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 last:pb-0">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'tools' })}>Tools</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            A calculator, for the salary arithmetic every offer turns into. Its history is for this
            visit only.
          </dd>
        </div>
      </dl>
    </Panel>
  )
}

/* -------------------------------- profile --------------------------------- */

export function ProfileSection() {
  return (
    <Panel id="profile" className="scroll-mt-4">
      <PanelTitle hint="the profile is not part of the checklist">Fill in your profile</PanelTitle>
      {/* This paragraph said the profile was "kept for the visit only rather
          than writing it anywhere, which is why the checklist above cannot
          tick for it". That stopped being true when the profile became a
          record like any other — `Profile.tsx` retracted the same sentence in
          its save toast, and this was the last place in the app still making
          the claim. The real reason it is not a checklist step is duller and
          true: there is one profile whether or not you have filled it in, so
          there is nothing for a count of records you have created to count. */}
      <p className="text-sm text-text-2">
        Your basics, links, target roles and match terms live under{' '}
        <Go to={profilePath()}>My profile</Go>. They are what the scout would score against and what
        the assistant would draft from, so they matter. Saving writes them to this browser and keeps
        them, exactly like every other record — the checklist above leaves them out because there is
        one profile either way, and a step that is done the moment you arrive is not a step.
      </p>
      <p className="mt-2 text-sm text-text-2">
        Documents you list on the profile are filed in the Vault&rsquo;s documents bucket rather
        than in a second place that could disagree with it, and the whole profile saves as one
        change, so one Undo puts it back.
      </p>
    </Panel>
  )
}
