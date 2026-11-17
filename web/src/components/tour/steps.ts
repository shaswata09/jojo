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
  /*
   * What the step SAYS is not here: it is the `tour` catalog's
   * `steps.<id>.title`, `.body` and — for a hands-on step — `.task`, so it is
   * read in the language jojo is shown in when the card draws.
   */
  /** A hands-on step: how the tour knows it was done. */
  task?: { done: TourCheck }
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
    task: { done: { kind: 'mascot' } },
  },
  {
    id: 'moves',
    target: 'moves',
    side: 'right',
    gesture: 'point',
  },
  {
    id: 'runtime',
    target: 'runtime',
    side: 'right',
  },

  /* --- applications ------------------------------------------------------ */
  {
    id: 'applications',
    target: 'nav:Applications',
    side: 'right',
    task: { done: { kind: 'route', path: applicationsPath() } },
    gesture: 'point',
  },
  {
    id: 'layout',
    route: applicationsPath(),
    target: 'layout',
    side: 'bottom',
    task: { done: { kind: 'query', param: 'view', value: 'table' } },
  },
  {
    id: 'records',
    route: applicationsPath(),
    target: 'records',
    side: 'top',
    gesture: 'dance',
  },
  {
    id: 'keywords',
    route: applicationsPath(),
    target: 'keywords',
    side: 'bottom',
    task: {
      done: { kind: 'marked', target: 'keywords', attr: 'data-selected' },
    },
  },

  /* --- the top bar --------------------------------------------------------- */
  {
    id: 'new',
    target: 'new',
    side: 'bottom',
    task: { done: { kind: 'open', target: 'new-menu' } },
  },
  {
    id: 'new-menu',
    target: 'new-menu',
    side: 'left',
    open: true,
    only: 'new-menu',
    task: { done: { kind: 'closed', target: 'new-menu' } },
  },
  {
    id: 'search',
    target: 'search',
    side: 'bottom',
    task: {
      done: { kind: 'open', target: 'palette' },
    },
  },
  {
    id: 'palette',
    target: 'palette',
    side: 'bottom',
    open: true,
    only: 'palette',
    task: {
      done: { kind: 'closed', target: 'palette' },
    },
  },

  /* --- calendar and the vault ---------------------------------------------- */
  {
    id: 'calendar',
    target: 'nav:Calendar',
    side: 'right',
    task: { done: { kind: 'route', path: calendarPath() } },
    gesture: 'point',
  },
  {
    id: 'vault',
    target: 'nav:Vault',
    side: 'right',
    task: { done: { kind: 'route', path: vaultPath() } },
    gesture: 'point',
  },
  {
    id: 'files',
    route: vaultPath({ tool: 'files' }),
    target: 'files',
    side: 'bottom',
    task: { done: { kind: 'open', target: 'file-viewer' } },
  },
  {
    id: 'file-viewer',
    target: 'file-viewer',
    side: 'left',
    open: true,
    only: 'file-viewer',
  },
  {
    id: 'tools',
    route: vaultPath({ tool: 'tools' }),
    target: 'instruments',
    side: 'right',
    task: { done: { kind: 'open', target: 'pdf' } },
  },
  {
    id: 'pdf',
    target: 'pdf',
    side: 'top',
    open: true,
    only: 'pdf',
  },

  /* --- scout, statistics, the graph, the assistant -------------------------- */
  {
    id: 'scout',
    target: 'nav:Job scout',
    side: 'right',
    task: { done: { kind: 'route', path: scoutPath() } },
    gesture: 'lookAround',
  },
  {
    id: 'pipelines',
    route: scoutPath(),
    target: 'pipelines',
    side: 'bottom',
  },
  {
    id: 'statistics',
    target: 'nav:Statistics',
    side: 'right',
    task: { done: { kind: 'route', path: statisticsPath() } },
    gesture: 'point',
  },
  {
    id: 'stats',
    route: statisticsPath(),
    target: 'stats',
    side: 'bottom',
  },
  {
    id: 'graph',
    route: graphPath(),
    target: 'graph',
    side: 'left',
  },
  {
    id: 'chat',
    target: 'chat',
    side: 'top',
    gesture: 'typing',
  },

  /* --- settings ------------------------------------------------------------ */
  {
    id: 'settings',
    target: 'top:Settings',
    side: 'bottom',
    task: { done: { kind: 'route', path: settingsPath() } },
  },
  {
    id: 'model',
    route: settingsPath(),
    target: 'model',
    side: 'right',
  },
  {
    id: 'reader',
    route: settingsPath(),
    target: 'reader',
    side: 'left',
  },
  {
    id: 'keyword-manager',
    route: settingsPath(),
    target: 'keyword-manager',
    side: 'top',
  },
  {
    id: 'backup',
    route: settingsPath(),
    target: 'backup',
    side: 'top',
    gesture: 'flex',
  },
  {
    id: 'done',
    gesture: 'jazz',
  },
]
