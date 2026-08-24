/**
 * Five of the six sections for the pages the sidebar lists, in sidebar order.
 *
 * Grouped by the door rather than by size, which is the split the `Doors`
 * diagram at the top of the page already argues for: a reader looking for the
 * Calendar section knows it is one of the six in the sidebar before they know
 * anything else about it. Applications is the sixth and is in
 * `ApplicationsScreen.tsx`, being as long as three of these together.
 */

import { Address, Code, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import {
  calendarPath,
  dashboardPath,
  guidePath,
  scoutPath,
  statisticsPath,
  vaultPath,
} from '@/lib/links'

/* ----------------------------- dashboard ---------------------------------- */

export function TodayScreen() {
  return (
    <Screen id={S.dashboard} title="Today" where="sidebar, first row" to={dashboardPath()}>
      <p className="text-sm text-text-2">
        What the day owes you, and nothing else. Five panels, all counted from your records as they
        stand: <span className="text-text-1">Needs a decision</span> — the offer, deadline or
        interview with a clock on it — beside a month strip and a set of counters, then{' '}
        <span className="text-text-1">Owed this week</span>,{' '}
        <span className="text-text-1">Recent applications</span> and the{' '}
        <span className="text-text-1">Pipeline</span> breakdown.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          While nothing is tracked, the decision deck is replaced by a three-step checklist that
          opens the real dialogs and ticks itself off the store. Clearing every record in Settings
          brings it back, because it is reading the store rather than remembering that you once
          finished it.
        </li>
        <li>
          Colour on this page comes off the date and nothing else: red is past due, amber is due
          within 48 hours, and everything further out is plain however important it is. Something
          you have finished goes grey rather than green — nothing here is a reward.
        </li>
        <li>
          Rows can be ticked off, snoozed by a day, three days or a week, or opened, without leaving
          the page. Each of those is a real write with an Undo in the toast.
        </li>
        <li>
          The month strip is its own little calendar — it steps months without moving the{' '}
          <Go to={calendarPath()}>Calendar</Go> page, and clicking a day opens that day there.
        </li>
      </ul>

      <Address>
        carries nothing. This page is <Code>/</Code>, and every control on it is either a link
        somewhere else or a write.
      </Address>
    </Screen>
  )
}

/* ------------------------------ calendar ---------------------------------- */

export function CalendarScreen() {
  return (
    <Screen id={S.calendar} title="Calendar" where="sidebar, third row" to={calendarPath()}>
      <p className="text-sm text-text-2">
        A month grid with the selected day&rsquo;s list underneath it, on one page. Deadlines,
        interviews, campus visits and reminders are all here because they are all the same kind of
        record — the reason that is worth knowing is on{' '}
        <Go to={guidePath('overview')}>How to use jojo</Go>.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          Dragging an entry onto another day reschedules it, with an Undo in the toast. Dropping it
          back on the day it came from writes nothing and says nothing — a toast claiming a move
          that did not happen is worse than silence.
        </li>
        <li>
          The key under the grid is built from what this month actually holds. A month with nothing
          overdue in it does not list an overdue colour, because a key promising a mark that is not
          on the grid sends you hunting for it.
        </li>
        <li>
          <span className="text-text-1">Go to month</span> browses years without moving the calendar
          behind it until you pick one, and it marks the real current month while you are away in
          another year. <span className="text-text-1">Today</span> comes back to today, and stays
          pressed-looking while you are already there.
        </li>
        <li>
          Paging between months keeps the day you were looking at, clamped to the month you land in:
          step off 31 January and you arrive on the last day of February rather than on a date that
          does not exist. The same clamp catches a hand-typed address, so <Code>?m=2&amp;d=31</Code>{' '}
          answers with a real day instead of an empty grid.
        </li>
        <li>
          <span className="text-text-1">Add event</span> is prefilled with the day on screen, which
          on a calendar is almost always the day you meant.
        </li>
        <li>
          <span className="text-text-1">Export to my calendar</span> writes every date jojo holds as
          an <Code>.ics</Code>, with a reminder on each. It is here because jojo sends no
          notifications of its own: the calendar you already get alerts from is the only thing that
          can warn you about a deadline while this app is shut. It includes each offer&rsquo;s
          respond-by, which lives on the application rather than on the timeline and so has never
          appeared on this grid. The file is a copy taken now — change a date and export again.
        </li>
      </ul>

      <Address>
        carries the year, the month, the day and the entry you arrived at — with today&rsquo;s year
        and month left out when that is where you are, so a link to next month is{' '}
        <Code>/calendar?m=11&amp;d=3</Code>. The last of the four, <Code>focus</Code>, lights a row
        for a couple of seconds and then removes itself from the address, so a URL you copy
        afterwards is the day rather than a row nobody is looking at any more.
      </Address>
    </Screen>
  )
}

/* -------------------------------- vault ----------------------------------- */

export function VaultScreen() {
  return (
    <Screen id={S.vault} title="Vault" where="sidebar · six tools, one page" to={vaultPath()}>
      <p className="text-sm text-text-2">
        Everything you set aside to come back to. The segmented control in the header switches
        between six tools and only one is on screen at a time, which is the thing most people miss:
        the Vault is not a list, and five of its six tools are behind a tab.
      </p>

      <dl className="mt-3.5 divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 first:pt-0">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'reminders' })}>Reminders</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Grouped Overdue, Today, Upcoming and Completed. Ticking one off is the whole job, and
            the same snooze steps as the dashboard are on every row.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'links' })}>Links</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Filed under Posting, Institution, Person or Guide, and movable between them afterwards.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'files' })}>Files</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Buckets To read, Applications, Talks and Admin. Drop a file on the list or pick one —
            see below for what is actually kept.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'snippets' })}>Snippets</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Tagged Cover letter, Application form, Email or Bio. These are what the{' '}
            <span className="text-text-1">Draft a message</span> dialog is built out of, and where
            the Assistant files a reply you save.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'people' })}>People</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            Referees, search chairs, recruiters — anyone the search actually runs through. They file
            under a job exactly as a CV does, and for the same reason it is a list rather than one
            id: a referee writes for every position you name them on. Before this they lived inside
            the text of a reminder, which is why nothing could answer &ldquo;whose letter is still
            outstanding&rdquo;.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 last:pb-0">
          <dt className="basis-24 font-medium">
            <Go to={vaultPath({ tool: 'tools' })}>Tools</Go>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            A calculator, basic or scientific, for the arithmetic every offer turns into. It keeps
            the last thirty lines for this visit and nothing after you close the tab.
          </dd>
        </div>
      </dl>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          The keyword filter above the list belongs to the tool you have open, so the count beside a
          keyword describes this tab rather than the whole Vault. It is not drawn at all on Tools,
          which holds no records, or on a tab with nothing in it.
        </li>
        <li>
          Each of the four lists has its own search box and bucket filter, and neither is in the
          address — the open tab and the record you arrived at are.
        </li>
        <li>
          <Code>/reminders</Code> redirects here. Reminders were a page of their own before they
          were a tool, and links taken back then still land.
        </li>
      </ul>

      <NotConnected title="Files are recorded, not stored">
        A file gives up its name, its size and its type, and that is all jojo keeps — there is
        nowhere on your disk for it to put the document itself. A file you pick or drop during this
        visit previews for real, from the bytes the browser handed over, for as long as the tab
        lives; the rows that came with the demo data have no bytes behind them and preview a
        labelled placeholder instead. Nothing is uploaded and no contents are read.
      </NotConnected>

      <Address>
        carries the open tool and, briefly, the record a link pointed at:{' '}
        <Code>/vault?tool=snippets</Code>. Switching tabs drops the highlight with it.
      </Address>
    </Screen>
  )
}

/* -------------------------------- scout ----------------------------------- */

export function ScoutScreen() {
  return (
    <Screen id={S.scout} title="Job scout" where="sidebar, fifth row" to={scoutPath()}>
      <p className="text-sm text-text-2">
        Three panels: the saved searches you would like run, the matches such a search would
        produce, and a box that saves a posting you found yourself. The strip at the top of the page
        says which of those is waiting on something, and it is the first thing on screen for that
        reason.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is real</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          <span className="text-text-1">Pipelines</span> are records like any other — a board to
          watch, the terms that matter and how often to look. Writing, editing and deleting them all
          work and survive a reload. A pipeline you switch on reads{' '}
          <span className="text-text-1">paused</span> rather than running, which is the honest word
          for it.
        </li>
        <li>
          <span className="text-text-1">Save a posting</span> works with nothing connected. What is
          kept is the URL, the employer guessed from it, and the day you saved it — enough to find
          the ad again and to apply from. Nothing fetches the page.
        </li>
        <li>
          <span className="text-text-1">Add to applications</span>, on a match or a saved posting,
          creates the application and links the two rather than moving the row. The row then says
          where it went, so you cannot make the trip twice.
        </li>
      </ul>

      <NotConnected title="Snapshots wait on a local model. The scores do not.">
        The matches are still the ones that shipped with the demo data — nothing has crawled a board
        — but the percentage on each is computed here, on this device, against the match terms,
        target roles and regions on your profile, and every row says what it matched on. A profile
        with nothing in it reads <span className="text-text-1">not scored</span> rather than a
        confident number over nothing. <span className="text-text-1">Open snapshot</span> is the
        part that does wait: it is disabled on every saved posting and says why when you hover it,
        because no page was ever fetched and showing one would claim a file jojo does not have.
      </NotConnected>

      <Address>
        carries the row a link pointed at, named by which list it is in —{' '}
        <Code>/scout?focus=match:unt</Code> or <Code>focus=posting:…</Code>. Both lists mint their
        ids separately, so the list has to be part of the parameter for the right row to light up.
      </Address>
    </Screen>
  )
}

/* ------------------------------ statistics -------------------------------- */

export function StatisticsScreen() {
  return (
    <Screen id={S.statistics} title="Statistics" where="sidebar, last row" to={statisticsPath()}>
      <p className="text-sm text-text-2">
        Headline rates, when you applied, where each one came from, how far applications got, how
        they ended, what to work on next, and applications, replies, interviews and offers split by
        kind of role. Every figure is counted from your applications at the moment you look.
      </p>

      <h3 className="mt-4 text-sm font-medium">What is not obvious</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>
          Only the stage a record is in now is stored, so the funnel counts each application as far
          as it shows. A record rejected after an interview is counted by the dates it carries and
          no further, and the two panels this affects say{' '}
          <span className="text-text-1">as far as each record shows</span> in their headings rather
          than quietly reporting a number they cannot stand behind.
        </li>
        <li>
          Figures marked <span className="text-text-1">typical</span> are a sample search to compare
          yourself against, not your own history — the switch behind the gear hides them. jojo keeps
          no history of its own numbers, which is why nothing here reports a change over time.
        </li>
        <li>
          The legend under the outcomes bar switches bands off, and the heading then says how many
          of the total are still shown. The percentages recount against what is left rather than
          staying still.
        </li>
        <li>
          The page holds itself back rather than inventing a denominator. With nothing sent there
          are no headline rates and no funnel — a reply rate over zero applications is a made-up
          number — and with no records at all the whole page is one empty state.
        </li>
      </ul>

      <Address>carries nothing. The switches and the legend are for this visit.</Address>
    </Screen>
  )
}
