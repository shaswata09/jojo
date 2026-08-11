/**
 * The Applications section, on its own because it is the longest on the page.
 *
 * It is one of the six the sidebar lists — the rest are in `SidebarScreens.tsx`
 * — and it is here rather than with them because it is three sections' worth of
 * material under one heading: the two layouts, moving a card between stages,
 * and the record itself.
 */

import { Address, Code, Go, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { applicationsPath, guidePath } from '@/lib/links'

export function ApplicationsScreen() {
  return (
    <Screen
      id={S.applications}
      title="Applications"
      where="sidebar · board, table and one record"
      to={applicationsPath()}
      open="the board"
    >
      <p className="text-sm text-text-2">
        Every position you are tracking, in one of two layouts over the same records, plus the
        record itself at its own address. The six stages and what moving between them asks you for
        are on <Go to={guidePath('overview')}>How to use jojo</Go>; this is the page they happen on.
      </p>

      <h3 className="mt-4 text-sm font-medium">Board and table are not the same view twice</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The board is one column per stage with a count in each header.{' '}
          <span className="text-text-1">Add here</span> at the foot of a column opens a new record
          already in that stage — logging a job you have already interviewed for should not mean
          adding a draft and dragging it four columns.
        </li>
        <li>
          The table sorts by Position, Stage and Last activity; clicking the same header again
          reverses it. Role and Next date are columns, not sort keys.
        </li>
        <li>
          The stage filter chips are table-only. The board is already grouped by stage, so filtering
          it would blank five columns rather than shorten a list — switching to Board clears that
          filter rather than hiding it still switched on.
        </li>
        <li>
          The search box matches the employer, the position, the note, the role tag and the stage
          name, so typing &ldquo;offer&rdquo; finds a record whose only mention of it is a chip. The
          counts on the stage chips are over what the search and the keyword chips have left, not
          over everything.
        </li>
        <li>
          When the list comes back empty it names the filters holding it that way, and offers to
          drop all of them at once.
        </li>
      </ul>

      <h3 className="mt-4 text-sm font-medium">Moving a card between stages</h3>
      <p className="mt-1 text-sm text-text-2">
        The grip sits on the left edge of a card. Drag it and the card lifts out of its column — the
        column you are over takes the accent border and opens a dashed slot where the card will
        land. Dragging is not the only way, and with a keyboard it is the slow way — crossing two
        columns is a Space and twenty arrow presses. Every card carries a stage menu under its own
        stage pill, and in the table the stage chip on a row is that same menu; either is two
        presses.
      </p>
      <dl className="mt-3 divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-44 font-medium">From the board or the table</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            The move happens as you make it, and the toast says which stage it came from and offers
            Undo. A drag and a menu pick are the same write, so a mis-drop is as recoverable as a
            mis-click — which it was not until the drag went through the same path as everything
            else.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-44 font-medium">From inside the record</dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            The stage menu in the record&rsquo;s own header is the one that can open a short form
            first, and it only opens when that move has something to ask: Submitted, Interview,
            Offer and Closed do, Draft and Screening call do not. Leaving a record that already has
            an offer always asks, whatever the destination, because the offer has to be kept or
            dropped deliberately.
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-text-2">
        The form has three exits and none of them is a trick:{' '}
        <span className="text-text-1">Cancel</span> writes nothing,{' '}
        <span className="text-text-1">Move without details</span> changes the stage and touches
        nothing else, and the last one applies what you filled in. Where it offered to put a date on
        your calendar, the toast afterwards says it did.
      </p>

      <h3 className="mt-4 text-sm font-medium">The record itself</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          It opens over the list rather than instead of it. On a laptop it is a sheet across the
          right of the board, closed by Escape, by the backdrop or by the X in its own header; below
          that width it takes the whole page. Either way Back closes the record and leaves your
          view, search, stage and sort exactly as they were.
        </li>
        <li>
          Its address is a name — <Code>/applications/rice</Code> — because record ids are minted
          per store and a bookmarked id would be dead after loading the demo data again. A link
          built from an id still resolves.
        </li>
        <li>
          The note saves when you click away from it and says &ldquo;Note saved&rdquo; underneath.
          There is no Save button to forget.
        </li>
        <li>
          Deleting counts what survives before it asks — the reminders, events and saved items filed
          under the record are kept and unlinked, never deleted — and the Undo in the toast puts
          back those links too, which you could not rebuild by adding the application again.
        </li>
        <li>
          A link to a record that has been deleted lands on a panel that says so, rather than on an
          error. Nothing else was removed with it.
        </li>
      </ul>

      {/* The offer link read "everything at offer" while landing on
          everything: `applicationsPath({ stage: 'offer' })` omits `view`,
          which defaults to the board, and the board draws `pool` — filtered
          by the search, the role and the keyword selections, never by the
          stage, because it is already grouped into stage columns. Only
          `tableRows` narrows by `stageFilter` and only the table renders the
          stage chips, so the filter went nowhere and the page read 12 shown
          of 12 under a label promising one. Naming the table is the fix. The
          same defect was found and fixed on `GuideOverview.tsx` first; it was
          reintroduced here by copying the sentence rather than the URL. */}
      <Address>
        carries the layout, the search text, and — because both are the table&rsquo;s own controls —
        the stage filter and the sort key, so{' '}
        <Go to={applicationsPath({ view: 'table', sort: 'stage' })}>the table sorted by stage</Go>{' '}
        and <Go to={applicationsPath({ view: 'table', stage: 'offer' })}>everything at offer</Go>{' '}
        are links you can keep. A stage in the address does nothing until the address also says
        table. The role filter and the keyword chips beside them are not in it at all: they are this
        tab&rsquo;s selection and they reset when you reload.
      </Address>
    </Screen>
  )
}
