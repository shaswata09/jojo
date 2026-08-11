import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { Kbd } from '@/components/guide/Kbd'
import { STAGES } from '@/data/seed'
import type { DialogName } from '@/lib/dialogs-context'
import { applicationsPath, settingsPath, vaultPath } from '@/lib/links'

/**
 * What the tour says, in order. The mechanism that walks it is in
 * `@/components/guide/GuidedTour`, whose header carries the design argument for
 * why the tour has this shape and not one of the three it could have had.
 *
 * THE RULE A NEW STEP MUST NOT BREAK: it never types, never submits and never
 * writes. A hand-off opens the real control, empty — `props` chooses which form
 * opens, never what is in it. The full reasoning is on `GuidedTour`.
 */

/**
 * Where a step hands over.
 *
 * A union rather than two optional fields, so a hand-off cannot be written with
 * both or neither — the version with `to?` and `dialog?` needed a non-null
 * assertion at the call site, which is the type system asking to be told which
 * of the two this is.
 */
export type Handoff = { label: string; note: string } & (
  | { kind: 'route'; to: string }
  /**
   * The real dialog, opened by name the way the checklist on this page opens
   * it — never a copy of it, and never one with anything filled in.
   */
  | { kind: 'dialog'; name: DialogName; props?: Record<string, unknown> }
)

export type TourStep = {
  /** A stable name for the step, and the React key of its body. */
  id: string
  title: string
  /** One line, read out with the title. */
  lede: string
  body: ReactNode
  handoff?: Handoff
}

export const STEPS: TourStep[] = [
  {
    id: 'contract',
    title: 'What this tour does',
    lede: 'Seven steps, and it changes nothing.',
    body: (
      <>
        <p>
          It points at things and opens the real controls on the real pages. It never types anything
          for you, never saves a record and never changes a setting — every step ends with something
          in front of you that you press, or do not.
        </p>
        <p className="mt-2">
          Nothing here is a picture of a feature behaving differently from the way it behaves. Where
          something cannot be shown without pretending — what you see if the browser refuses to
          store anything, for instance — it is described and not drawn.
        </p>
        <p className="mt-2">
          Close it whenever you like. Your place is kept in this browser, and the button you opened
          it with will offer to pick it up again.
        </p>
      </>
    ),
  },
  {
    id: 'application',
    title: 'One record holds a job application',
    lede: 'Everything else in jojo hangs off it.',
    body: (
      <>
        <p>
          A position, an employer, a stage and whatever you have written down about it. Deadlines,
          interviews, follow-ups, documents and keywords all attach to that one record, which is why
          nothing has to be typed twice. Six stages, and a record sits in exactly one of them:
        </p>
        {/* The six stages, from the same list the board and the table draw from. */}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {STAGES.map((stage) => (
            <li key={stage.id}>
              <Chip stage={stage.id}>{stage.label}</Chip>
            </li>
          ))}
        </ul>
        <p className="mt-3">
          The same records appear as a board or as a table — the segment at the top of the page
          switches between them and the choice is in the address, so a link you send opens the way
          you left it. Dragging a card to another column is a real edit: it announces itself and it
          undoes.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open Applications',
      to: applicationsPath(),
      note: 'Leaves the guide for the board. Come back here and the tour resumes at the next step.',
    },
  },
  {
    id: 'new',
    title: 'Making one',
    lede: 'New in the top bar, or the n key.',
    body: (
      <>
        <p>
          The <strong className="font-medium text-text-1">New</strong> button in the top bar makes
          any of six things — an application, a reminder, a calendar entry, a drafted message, a
          saved link, a saved posting. Pressing <Kbd>n</Kbd> anywhere that is not a text box opens
          the same menu.
        </p>
        <p className="mt-2">
          One dialog is open at a time, by design: asking for a second replaces the first rather
          than stacking them. Nothing is written until you save, and closing a half-filled form
          costs nothing but the typing.
        </p>
      </>
    ),
    handoff: {
      kind: 'dialog',
      name: 'application',
      label: 'Open the real dialog',
      note: 'Closes the tour and opens the new-application form, empty. It is the same dialog the New button opens, not a copy of it.',
    },
  },
  {
    id: 'dates',
    title: 'A deadline, an interview and a follow-up are one kind of record',
    lede: 'Which is why one entry reaches three screens.',
    body: (
      <>
        <p>
          They differ by a field, not by a type. A reminder is that same record with a nudge
          switched on — so it appears in the calendar, on the dashboard and on the application it
          belongs to at once, and ticking it off in any of them ticks it off in all of them.
        </p>
        <p className="mt-2">
          Once a reminder&rsquo;s date has passed it stays flagged on the dashboard until you
          complete it. Dragging one onto another day in the{' '}
          <span className="text-text-1">calendar</span> reschedules it, with an undo.
        </p>
      </>
    ),
    handoff: {
      kind: 'dialog',
      name: 'timelineItem',
      // `mode` chooses which of the two forms opens; it is not a value in a
      // field. Nothing on this hand-off pre-fills anything, which is the
      // difference between opening a form and filling one in.
      props: { mode: 'event' },
      label: 'Open the real dialog',
      note: 'Closes the tour and opens the calendar-entry form, empty. Nothing is saved unless you save it.',
    },
  },
  {
    id: 'palette',
    title: 'The fastest way in is the keyboard',
    lede: '⌘K searches, and runs the app’s own operations.',
    body: (
      <>
        <p>
          <Kbd>⌘K</Kbd> — <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> on Windows and Linux — opens a search across
          your applications, reminders and calendar entries. Below those it lists the app&rsquo;s
          named operations, each with a form built from the operation itself rather than written out
          by hand, so what the palette offers cannot drift from what the app can do.
        </p>
        <p className="mt-2">
          It is also the way to the pages the sidebar does not list: the graph, transfer, your
          profile, the assistant, settings and this guide. The shortcut is ignored while you are
          typing in a field, so it never steals a keystroke from a note.
        </p>
        <p className="mt-2 text-text-3">
          No button for this one — there is nothing here that can open it. Close the tour and press
          the keys.
        </p>
      </>
    ),
  },
  {
    id: 'undo',
    title: 'Undo is real, and every write is written down',
    lede: 'Two undos, and they do different things.',
    body: (
      <>
        <p>
          <Kbd>⌘Z</Kbd> undoes the last thing you changed and <Kbd>⇧⌘Z</Kbd> puts it back, anywhere
          in the app, suppressed while you are typing. The message that appears after a change
          carries its own Undo, and the two are not the same: the message reverts <em>that</em>{' '}
          change, <Kbd>⌘Z</Kbd> reverts the most recent one. Seconds apart, those are two different
          records.
        </p>
        <p className="mt-2">
          Every write is listed in the audit log at the foot of Settings, newest first. The log
          survives a reload; the undo stack does not — it starts empty each visit, because an undo
          that reached back to last Tuesday is not an undo.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open Settings',
      to: settingsPath(),
      note: 'The audit log and the diagnostics panel are at the foot of that page.',
    },
  },
  {
    id: 'storage',
    title: 'Where your records actually are',
    lede: 'A database inside this browser, on this machine.',
    body: (
      <>
        <p>
          Records are written to this browser as you work, so closing the tab is safe. Nothing is
          sent anywhere and nothing syncs — clearing your browser data, switching browsers or losing
          the disk takes them with it. Settings exports the lot as a <Kbd>.json</Kbd> file, which is
          a copy taken at that moment rather than a backup that keeps up.
        </p>
        <p className="mt-2">
          If the browser ever refuses to store anything, the app keeps running behind a banner
          saying which of three things went wrong. One of those arms has no reload button on
          purpose: reloading would throw away writes still waiting to be saved. There is no picture
          of it here, because you should only ever see it if it happens.
        </p>
        <p className="mt-2">
          That is the tour. The rest of the guide covers every screen in turn, the record model
          underneath, and what jojo is built from.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open the Vault',
      to: vaultPath(),
      note: 'Reminders, links, files, snippets and a calculator — the five tools that are not the applications list.',
    },
  },
]
