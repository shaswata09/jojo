import type { MascotPose } from '@/lib/mascot-context'
import {
  applicationsPath,
  calendarPath,
  graphPath,
  scoutPath,
  settingsPath,
  statisticsPath,
  vaultPath,
} from '@/lib/links'

/**
 * The tour, step by step: what each one points at, what it says, and — for the
 * hands-on ones — what the reader is asked to do and how the tour knows they
 * did it. The overlay that walks it is `TourOverlay`; the rules for when a
 * task counts as done are `isDone` in `tour-logic.ts`.
 *
 * THE RULE A NEW STEP MUST NOT BREAK: the tour never types, never saves and
 * never changes anything. A task asks the READER to do something, and every
 * task here is one that writes nothing — opening a page, switching a view,
 * opening a menu, drawing on the robot. Moving a card or saving a form would
 * be a real edit to their job search, made because a tutorial said so; those
 * are pointed at and explained, never asked for.
 */

/** How the tour tells that a hands-on task is done. */
export type TourCheck =
  /** The reader is on this page. */
  | { kind: 'route'; path: string }
  /** The address has this query value (a view switch is in the address). */
  | { kind: 'query'; param: string; value: string }
  /** An element marked `data-tour="…"` is on the page — a menu that opened. */
  | { kind: 'open'; target: string }
  /** That element has gone again — the menu was closed. */
  | { kind: 'closed'; target: string }
  /** The mascot played a gesture: the reader poked it or drew on it. */
  | { kind: 'mascot' }
  /** That element carries this attribute — a keyword picked in the filter row. */
  | { kind: 'marked'; target: string; attr: string }

export type TourStep = {
  id: string
  /** The page the step is on; the tour goes there first. Absent: wherever the reader is. */
  route?: string
  /*
   * (A route may carry a query — `/vault?tool=files` is the Files tab — and
   * only the values it names are checked.)
   */
  /**
   * The element to light up, by its `data-tour` mark. Absent, or not on the
   * page (the sidebar is a closed drawer on a phone): the card is centred and
   * nothing is lit.
   */
  target?: string
  /** Which side of the target the card prefers. */
  side?: 'right' | 'bottom' | 'left' | 'top'
  title: string
  body: string
  /** A hands-on step: what to do, and how the tour knows it was done. */
  task?: { say: string; done: TourCheck }
  /**
   * The page stays usable around the card: a menu or the palette is open and
   * the reader is working in it. Otherwise only the lit element takes clicks.
   */
  open?: boolean
  /** What the robot does as the step opens. */
  gesture?: Exclude<MascotPose, 'idle'>
  /**
   * The step is about something the previous one opened — the New menu, the
   * palette — and is passed over when that is not open: a reader who skipped
   * "open the menu" must not be told "close the menu", or ticked for having
   * done it.
   */
  only?: string
}

export const STEPS: TourStep[] = [
  /* --- jojo and the sidebar ------------------------------------------------ */
  {
    id: 'jojo',
    target: 'mascot',
    side: 'right',
    title: 'Meet jojo',
    body: 'Your assistant lives here. It reacts to what you do — a dance when an application goes out, a nod when a task is done — and follows your pointer around the page.',
    task: { say: 'Tap jojo, or draw a circle on it.', done: { kind: 'mascot' } },
  },
  {
    id: 'moves',
    target: 'moves',
    side: 'right',
    title: 'Every move, and how to draw it',
    body: 'This button lists all of jojo’s moves, each with the stroke that plays it — a swipe up to hop, a Z to doze off — and credits the artist of the 3D model.',
    gesture: 'point',
  },
  {
    id: 'runtime',
    target: 'runtime',
    side: 'right',
    title: 'Where your records live',
    body: '“Saved here” is browser storage: a database inside this browser, on this machine — nothing is sent anywhere and nothing syncs. The other tiles say whether a model is connected and offer to move everything to another device. Each one opens where it is set up.',
  },

  /* --- applications ------------------------------------------------------ */
  {
    id: 'applications',
    target: 'nav:Applications',
    side: 'right',
    title: 'Your applications',
    body: 'One record per job: the position, the employer, its stage and your notes. Deadlines, interviews and documents all hang off it, so nothing is typed twice.',
    task: { say: 'Open Applications.', done: { kind: 'route', path: applicationsPath() } },
    gesture: 'point',
  },
  {
    id: 'layout',
    route: applicationsPath(),
    target: 'layout',
    side: 'bottom',
    title: 'A board or a table',
    body: 'The same records, two ways. The board shows the stages as columns; the table sorts and searches. The choice is in the address, so a link opens the way you left it.',
    task: { say: 'Switch to Table.', done: { kind: 'query', param: 'view', value: 'table' } },
  },
  {
    id: 'records',
    route: applicationsPath(),
    target: 'records',
    side: 'top',
    title: 'Six stages, and jojo cheers each one',
    body: 'Draft, Submitted, Screen, Interview, Offer, Closed. On the board, drag a card to its next column: jojo dances when a draft goes out, powers up for an interview and leaps for an offer. Every move undoes.',
    gesture: 'dance',
  },
  {
    id: 'keywords',
    route: applicationsPath(),
    target: 'keywords',
    side: 'bottom',
    title: 'Keywords are your tags',
    body: 'One set of tags across applications, reminders and the vault. Tag a record from the tag button on its row, add a new keyword with +, and right-click a chip to rename, recolour or delete it.',
    task: {
      say: 'Pick a keyword to filter by it.',
      done: { kind: 'marked', target: 'keywords', attr: 'data-selected' },
    },
  },

  /* --- the top bar --------------------------------------------------------- */
  {
    id: 'new',
    target: 'new',
    side: 'bottom',
    title: 'Make anything',
    body: 'New makes an application, a reminder, a calendar entry, a drafted message, a saved link or a saved posting. The n key opens it from anywhere you are not typing.',
    task: { say: 'Open the New menu.', done: { kind: 'open', target: 'new-menu' } },
  },
  {
    id: 'new-menu',
    target: 'new-menu',
    side: 'left',
    open: true,
    only: 'new-menu',
    title: 'Nothing is saved until you save',
    body: 'Each of these opens its own form. Closing a half-filled form costs nothing but the typing.',
    task: { say: 'Close the menu — press Esc.', done: { kind: 'closed', target: 'new-menu' } },
  },
  {
    id: 'search',
    target: 'search',
    side: 'bottom',
    title: 'The fastest way in',
    body: 'Search every application, reminder and calendar entry, jump to any page — including the ones the sidebar does not list — or run one of the app’s own operations.',
    task: {
      say: 'Press ⌘K (Ctrl K), or click the search bar.',
      done: { kind: 'open', target: 'palette' },
    },
  },
  {
    id: 'palette',
    target: 'palette',
    side: 'bottom',
    open: true,
    only: 'palette',
    title: 'Type to find anything',
    body: 'A role, an organisation or a stage. The arrow keys pick, Enter goes.',
    task: {
      say: 'Close it with Esc when you are done looking.',
      done: { kind: 'closed', target: 'palette' },
    },
  },

  /* --- calendar and the vault ---------------------------------------------- */
  {
    id: 'calendar',
    target: 'nav:Calendar',
    side: 'right',
    title: 'Every date in one place',
    body: 'Deadlines, interviews and follow-ups are one kind of record, so one entry shows on the calendar, on the dashboard and on its application. Drag one to another day to reschedule it.',
    task: { say: 'Open the Calendar.', done: { kind: 'route', path: calendarPath() } },
    gesture: 'point',
  },
  {
    id: 'vault',
    target: 'nav:Vault',
    side: 'right',
    title: 'The vault',
    body: 'Everything a job search piles up besides applications: reminders, saved links, files, the snippets you paste into every form, the people you know, and a few tools.',
    task: { say: 'Open the Vault.', done: { kind: 'route', path: vaultPath() } },
    gesture: 'point',
  },
  {
    id: 'files',
    route: vaultPath({ tool: 'files' }),
    target: 'files',
    side: 'bottom',
    title: 'Files, previewed in place',
    body: 'Drop in a CV, a statement or a posting. PDFs, images, text and saved web pages open right here, and each file can carry a note and keywords. Files are stored in this browser, not uploaded.',
    task: { say: 'Click a file to preview it.', done: { kind: 'open', target: 'file-viewer' } },
  },
  {
    id: 'file-viewer',
    target: 'file-viewer',
    side: 'left',
    open: true,
    only: 'file-viewer',
    title: 'The preview',
    body: 'Read it without leaving the page. With the document reader connected (Settings), the assistant can read what is inside it too.',
  },
  {
    id: 'tools',
    route: vaultPath({ tool: 'tools' }),
    target: 'instruments',
    side: 'right',
    title: 'Tools',
    body: 'A calculator, basic or scientific, that keeps a history of its sums — and a PDF editor.',
    task: { say: 'Open the PDF editor.', done: { kind: 'open', target: 'pdf' } },
  },
  {
    id: 'pdf',
    target: 'pdf',
    side: 'top',
    open: true,
    only: 'pdf',
    title: 'PDF tools',
    body: 'Merge several PDFs into one, reorder or delete pages, and mark one up — all inside this browser, so no document is ever uploaded. Drop PDFs straight onto this panel.',
  },

  /* --- scout, statistics, the graph, the assistant -------------------------- */
  {
    id: 'scout',
    target: 'nav:Job scout',
    side: 'right',
    title: 'Job scout',
    body: 'Saved searches that watch job boards for you.',
    task: { say: 'Open Job scout.', done: { kind: 'route', path: scoutPath() } },
    gesture: 'lookAround',
  },
  {
    id: 'pipelines',
    route: scoutPath(),
    target: 'pipelines',
    side: 'bottom',
    title: 'Pipelines',
    body: 'Each pipeline is a search on a board (HigherEdJobs, AcademicCareers and others). It runs on a schedule or when you press Run now; what it finds waits as suggestions you approve or discard, and an approved one becomes a draft application.',
  },
  {
    id: 'statistics',
    target: 'nav:Statistics',
    side: 'right',
    title: 'Statistics',
    body: 'How your search is going, counted from your own records.',
    task: { say: 'Open Statistics.', done: { kind: 'route', path: statisticsPath() } },
    gesture: 'point',
  },
  {
    id: 'stats',
    route: statisticsPath(),
    target: 'stats',
    side: 'bottom',
    title: 'Rates, with honest error bars',
    body: 'Response and interview rates, a funnel and a week-by-week chart — each rate with the range it could really be, since a handful of applications is a small sample. It follows the role filter in the top bar.',
  },
  {
    id: 'graph',
    route: graphPath(),
    target: 'graph',
    side: 'left',
    title: 'The knowledge graph',
    body: 'Every record — applications, employers, people, dates, files — is a node, and how they connect is the edges. Ask a question in words or build one, and the matching records light up. It is not in the sidebar; ⌘K gets you here.',
  },
  {
    id: 'chat',
    target: 'chat',
    side: 'top',
    title: 'Chat with jojo',
    body: 'The assistant can find, add and update your records with the app’s own tools, and asks before it changes anything unless you tell it not to. It needs a model — which is the next step.',
    gesture: 'typing',
  },

  /* --- settings ------------------------------------------------------------ */
  {
    id: 'settings',
    target: 'top:Settings',
    side: 'bottom',
    title: 'Settings',
    body: 'Models, the document reader, keywords, your data — and every gesture jojo knows.',
    task: { say: 'Open Settings.', done: { kind: 'route', path: settingsPath() } },
  },
  {
    id: 'model',
    route: settingsPath(),
    target: 'model',
    side: 'right',
    title: 'Connect a model',
    body: 'Pick where the assistant’s model runs. A local server — vLLM, LM Studio, llama.cpp, or Ollama — takes its address and keeps your records on this machine. OpenAI, Anthropic (Claude), OpenRouter, Groq or NVIDIA take an API key. Test connection checks it before anything is saved.',
  },
  {
    id: 'reader',
    route: settingsPath(),
    target: 'reader',
    side: 'left',
    title: 'Let it read your documents',
    body: 'MarkItDown turns PDFs, Word files, decks and spreadsheets into text the assistant can read. Copy the two commands here into a terminal — one installs it, one starts it — then press Test connection.',
  },
  {
    id: 'keyword-manager',
    route: settingsPath(),
    target: 'keyword-manager',
    side: 'top',
    title: 'Manage your keywords',
    body: 'Add keywords, rename them, give them any colour, or delete them. A rename carries everywhere the keyword is shown.',
  },
  {
    id: 'backup',
    route: settingsPath(),
    target: 'backup',
    side: 'top',
    title: 'Keep a backup',
    body: 'Clearing the browser takes your records with it, so export a backup now and then — one file with everything. jojo flexes when you do.',
    gesture: 'flex',
  },
  {
    id: 'done',
    title: 'That’s the tour',
    body: 'Undo is ⌘Z anywhere, and every change is listed in the audit log at the foot of Settings. The guide covers every screen in turn — How to use, in the top bar — and the tour is there to take again.',
    gesture: 'jazz',
  },
]
