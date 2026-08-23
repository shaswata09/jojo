import type { FeatherName } from '@/lib/timeline-visuals'

/**
 * The tour, as data.
 *
 * Its own file rather than sitting inside the component, so the copy can be read
 * and edited without scrolling past a sheet's worth of layout — the same split
 * `web/src/components/guide/tour/steps.tsx` makes, for the same reason.
 *
 * WHY THE PHONE'S STEPS ARE NOT THE WEB'S. They cover the same ground and they
 * cannot be the same words, because half of what the web tour points at does not
 * exist here: there is no ⌘K palette, no keyboard undo, and no browser storage
 * to explain. What replaces them is the part of this app a newcomer actually
 * has to be told — that the tab bar is the whole app, that a deadline and an
 * interview are one record, and that everything is on the handset with no
 * account behind it.
 *
 * WHY IT IS PROSE AND NOT COACH MARKS. An overlay that points at a real control
 * has to be mounted above the navigator and has to know where that control is on
 * screen; both are true only while the right screen is showing, so the overlay
 * spends most of its life pointing at nothing. The web tour's header works
 * through the same problem and lands in the same place. So each step says where
 * a thing is in words, and the reader looks — which survives a rotation, a
 * different phone size, and the tab bar being at the bottom on one platform and
 * the top on another.
 *
 * WHAT IT PROMISES: it changes nothing. No step writes a record, and the tour
 * has no handoff that opens an editor with anything filled in. That is a
 * deliberate difference from the web tour, which does hand over to real
 * controls: on a phone the tour IS a sheet, so handing off means dismissing
 * itself, and a tutorial that has to close to show you something cannot then
 * bring you back.
 */

export type TourStep = {
  /** Stable, and the React key. */
  id: string
  icon: FeatherName
  title: string
  /** One line, read with the title. */
  lede: string
  /** Paragraphs. Kept as an array so the sheet controls the spacing. */
  body: string[]
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'contract',
    icon: 'compass',
    title: 'What this tour does',
    lede: 'Six steps, and it changes nothing.',
    body: [
      'It points at things and tells you where they are. It never types anything for you, never saves a record and never changes a setting.',
      'Nothing here is a picture of a feature behaving differently from how it behaves. Where something cannot be shown without pretending, it is described rather than drawn.',
      'Close it whenever you like — your place is kept, and How to use will offer to pick it up again.',
    ],
  },
  {
    id: 'tabs',
    icon: 'grid',
    title: 'The five tabs are the whole app',
    lede: 'Today, Applications, Calendar, Vault, More.',
    body: [
      'Today is what is owed now: what is overdue, what is due, and the decisions waiting on you. It is the screen to open first and the one to close the app from.',
      'Applications is every job you are tracking, as a list or a board you can drag between stages. Calendar is the same dated records laid out by month. Vault is everything you have kept that is not an application — reminders, links, documents and snippets.',
      'More holds the rest: Job scout, Statistics, Profile, Transfer, Settings and this guide. Nothing is hidden behind a gesture.',
    ],
  },
  {
    id: 'application',
    icon: 'clipboard',
    title: 'One record holds a job',
    lede: 'Employer, role, stage, and everything filed under it.',
    body: [
      'Tap any row in Applications to open it. The stage — draft, submitted, screening call, interview, offer, closed — is the one field the rest of the app reads: Today counts from it, the board groups by it, and Statistics measures it.',
      'Under the record you will find its dates, the documents and links filed against it, and the conversations you have had about it with the assistant. Everything about one job is reachable from the one place.',
    ],
  },
  {
    id: 'dates',
    icon: 'calendar',
    title: 'A deadline and an interview are the same kind of record',
    lede: 'One dated thing, with a switch on it.',
    body: [
      'There is no separate deadline type. A dated record has a kind — deadline, interview, call, visit, prep, admin, follow-up — and a "show in reminders" switch. Turn it on and it appears in the Vault with a tick box and counts as owed on Today. Turn it off and it is a calendar entry and nothing more.',
      'That is why the new-reminder and new-event buttons open the same form: they differ only in which fields lead.',
      'A reminder can be about several jobs at once — a reference deadline covering three applications is one record, and it shows on all three.',
    ],
  },
  {
    id: 'vault',
    icon: 'archive',
    title: 'The Vault keeps what is not an application',
    lede: 'Reminders, links, files and snippets — filed under as many jobs as they belong to.',
    body: [
      'A CV goes to every application you send it to, so filing is a list rather than a slot. File it under three jobs and it appears on all three, and the graph can reach it from any of them.',
      'Snippets are the answers you retype on every form. Anything in [BRACKETS] stays blank when a draft loads one, so a person’s name is never filled in for you.',
      'Job postings live in their own drawer. They are somebody else’s document rather than something you wrote, which is why they never land among your own.',
    ],
  },
  {
    id: 'yours',
    icon: 'lock',
    title: 'Where your records actually are',
    lede: 'On this handset, with no account behind them.',
    body: [
      'Everything is stored on the device and survives closing the app. There is no sign-in, no sync and nothing uploaded — there is no server to upload to.',
      'What the app can reach is only what you point it at, and all of it is optional: a model server and a document reader at addresses you type into Settings, a job posting when you ask for one, and your other device over the local network during a Transfer.',
      'Settings can clear everything, and Transfer is how records move to another device without going through anyone else.',
    ],
  },
]
