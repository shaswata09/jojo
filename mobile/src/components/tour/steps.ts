import type { RootStackParamList, TabParamList } from '@/navigation/types'

/**
 * The phone's guided tour, step by step — the same shape as the web tour
 * (`web/src/components/tour/steps.ts`): a spotlight on the real screen, a card
 * beside it, and for the hands-on steps something to try, which the tour
 * notices and moves on from by itself. `TourOverlay` walks it; `isDone` in
 * `tour-logic.ts` decides when a task counts.
 *
 * THE RULE A NEW STEP MUST NOT BREAK: the tour never types, never saves and
 * never changes anything. A task asks the READER to do something, and every
 * task here writes nothing — opening a screen, switching a view. Dragging a
 * card or saving a form would be a real edit to their job search; those are
 * explained, never asked for.
 *
 * Where the phone differs from the browser, the steps say what the phone
 * does: it reads most documents on its own (only PDFs need the reader), its
 * tools are a calculator with no PDF editor, and More holds what the web
 * sidebar and top bar hold.
 */

/** A screen the tour can open: a tab, or a screen of the root stack. */
export type TourRoute = keyof TabParamList | Exclude<keyof RootStackParamList, 'Tabs'>

/** How the tour tells that a hands-on task is done. */
export type TourCheck =
  /** The reader is on this screen. */
  | { kind: 'route'; route: TourRoute }
  /** A marked control reports this value — a view switch, a tool picked. */
  | { kind: 'state'; target: string; value: string }

export type TourStep = {
  id: string
  /** The screen the step is on; the tour opens it first. Absent: wherever the reader is. */
  route?: TourRoute
  /**
   * What to light, by its `TourTarget` id. `tab:<name>` is one tab of the tab
   * bar. Absent, or not on screen: the card is centred and nothing is lit.
   */
  target?: string
  title: string
  body: string
  task?: { say: string; done: TourCheck }
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'A tour of jojo, hands on',
    body: 'It points at the real screens and asks you to try each thing as you go. It never types, saves or changes anything for you. Close it whenever you like — your place is kept, and How to use will pick it up again.',
  },
  {
    id: 'today',
    route: 'Today',
    target: 'tab:Today',
    title: 'Today',
    body: 'What is owed now: what is overdue, what is due, and the decisions waiting on you. The screen to open first.',
  },
  {
    id: 'applications',
    target: 'tab:Applications',
    title: 'Your applications',
    body: 'One record per job: the employer, the role, its stage and your notes. Its dates, documents and conversations all hang off it, so nothing is typed twice.',
    task: { say: 'Open Applications.', done: { kind: 'route', route: 'Applications' } },
  },
  {
    id: 'layout',
    route: 'Applications',
    target: 'layout',
    title: 'A list or a board',
    body: 'The same records, two ways. The list sorts and searches; the board shows the stages as columns.',
    task: { say: 'Switch to Board.', done: { kind: 'state', target: 'layout', value: 'board' } },
  },
  {
    id: 'records',
    route: 'Applications',
    target: 'records',
    title: 'Six stages',
    body: 'Draft, Submitted, Screening call, Interview, Offer, Closed. On the board, press and hold a card, then drag it to its next column; each card also has a stage menu. Every move can be undone.',
  },
  {
    id: 'search',
    route: 'Applications',
    target: 'header:search',
    title: 'Search everything',
    body: 'Applications, reminders and calendar entries, from any tab.',
    task: { say: 'Open search.', done: { kind: 'route', route: 'Search' } },
  },
  {
    id: 'search-screen',
    route: 'Search',
    target: 'search-field',
    title: 'Type to find anything',
    body: 'A role, an employer or a stage. Tap a result to open it, or go back when you are done looking.',
  },
  {
    id: 'new',
    route: 'Applications',
    target: 'header:new',
    title: 'Make anything',
    body: 'The + makes an application, a reminder, a calendar entry, a drafted message, a saved link or a saved posting. Nothing is saved until you save, and closing a half-filled form costs nothing.',
  },
  {
    id: 'calendar',
    target: 'tab:Calendar',
    title: 'Every date in one place',
    body: 'Deadlines, interviews and follow-ups are one kind of record, so one entry shows on the calendar, on Today and on its application.',
    task: { say: 'Open the Calendar.', done: { kind: 'route', route: 'Calendar' } },
  },
  {
    id: 'vault',
    target: 'tab:Vault',
    title: 'The vault',
    body: 'Everything that is not an application: reminders, links, files, the snippets you paste into every form, the people you know, and a calculator.',
    task: { say: 'Open the Vault.', done: { kind: 'route', route: 'Vault' } },
  },
  {
    id: 'vault-tools',
    route: 'Vault',
    target: 'vault-tools',
    title: 'One tool at a time',
    body: 'Each of these is its own list, and a keyword means the same thing in all of them.',
    task: { say: 'Pick Files.', done: { kind: 'state', target: 'vault-tools', value: 'files' } },
  },
  {
    id: 'files',
    route: 'Vault',
    target: 'files',
    title: 'Files, kept on the phone',
    body: 'A CV, a statement, a posting — copied into jojo’s own folder, so they survive the original being moved. Tap one to read it here; file it under as many applications as it belongs to.',
  },
  {
    id: 'more',
    target: 'tab:More',
    title: 'More',
    body: 'Everything else: Job scout, Statistics, the graph, Transfer, your profile, the assistant, Settings and this guide.',
    task: { say: 'Open More.', done: { kind: 'route', route: 'More' } },
  },
  {
    id: 'scout',
    route: 'More',
    target: 'more:Job scout',
    title: 'Job scout',
    body: 'Saved searches that watch job boards for you.',
    task: { say: 'Open Job scout.', done: { kind: 'route', route: 'JobScout' } },
  },
  {
    id: 'scout-screen',
    route: 'JobScout',
    title: 'Pipelines and suggestions',
    body: 'Each pipeline is a search on a board, run on a schedule or when you ask. What it finds waits as a suggestion you approve or discard, and an approved one becomes a draft application.',
  },
  {
    id: 'statistics',
    route: 'More',
    target: 'more:Statistics',
    title: 'Statistics',
    body: 'How your search is going, counted from your own records.',
    task: { say: 'Open Statistics.', done: { kind: 'route', route: 'Statistics' } },
  },
  {
    id: 'statistics-screen',
    route: 'Statistics',
    title: 'Rates, with honest ranges',
    body: 'Response and interview rates, a funnel and what to work on next — each rate with the range it could really be, since a handful of applications is a small sample.',
  },
  {
    id: 'graph',
    route: 'More',
    target: 'more:Graph',
    title: 'The knowledge graph',
    body: 'Every record — applications, employers, people, dates, files — drawn as the network it is.',
    task: { say: 'Open the Graph.', done: { kind: 'route', route: 'Graph' } },
  },
  {
    id: 'graph-screen',
    route: 'Graph',
    title: 'Everything, connected',
    body: 'Tap a node to see what it connects to, and ask a question to light up the records that match.',
  },
  {
    id: 'assistant',
    route: 'More',
    target: 'more:Assistant',
    title: 'The assistant',
    body: 'Chat with jojo: it finds, adds and updates your records with the app’s own tools, and asks before it changes anything. Until a model is connected it shows worked examples.',
  },
  {
    id: 'transfer',
    route: 'More',
    target: 'more:Transfer',
    title: 'Phone and computer',
    body: 'Transfer moves everything between this phone and jojo on your computer over your local network, without going through anyone else.',
  },
  {
    id: 'settings',
    route: 'More',
    target: 'more:Settings',
    title: 'Settings',
    body: 'Connections, appearance and your data.',
    task: { say: 'Open Settings.', done: { kind: 'route', route: 'Settings' } },
  },
  {
    id: 'device',
    route: 'Settings',
    target: 'device',
    title: 'Your records live on this phone',
    body: 'Written straight to the phone’s own storage as you work — no account, no sync, nothing uploaded. Export a copy, or Transfer it to your computer.',
  },
  {
    id: 'model',
    route: 'Settings',
    target: 'model',
    title: 'Connect a model',
    body: 'Where the assistant’s model runs. A server on your own machine — vLLM, Ollama or LM Studio — takes its address and keeps your records on your devices. OpenAI, Anthropic (Claude) and the other cloud providers take an API key. Test connection checks it before anything is saved.',
  },
  {
    id: 'reader',
    route: 'Settings',
    target: 'reader',
    title: 'Let it read your documents',
    body: 'The phone reads Word files, decks, saved pages and text on its own. PDFs need MarkItDown on your computer: start it with the two commands above, then Test connection.',
  },
  {
    id: 'done',
    title: 'That’s the tour',
    body: 'Every change can be undone, and How to use, under More, covers every screen in turn. The tour is there to take again.',
  },
]
