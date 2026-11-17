import { i18next } from '@/i18n/i18n'
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

/** Read at the moment a step is drawn, so the tour speaks the language jojo is in. */
const text = (step: string, field: 'title' | 'body' | 'say') =>
  i18next.t(`components:tour.steps.${step}.${field}`)

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    get title() {
      return text('welcome', 'title')
    },
    get body() {
      return text('welcome', 'body')
    },
  },
  {
    id: 'today',
    route: 'Today',
    target: 'tab:Today',
    get title() {
      return text('today', 'title')
    },
    get body() {
      return text('today', 'body')
    },
  },
  {
    id: 'applications',
    target: 'tab:Applications',
    get title() {
      return text('applications', 'title')
    },
    get body() {
      return text('applications', 'body')
    },
    task: {
      get say() {
        return text('applications', 'say')
      },
      done: { kind: 'route', route: 'Applications' },
    },
  },
  {
    id: 'layout',
    route: 'Applications',
    target: 'layout',
    get title() {
      return text('layout', 'title')
    },
    get body() {
      return text('layout', 'body')
    },
    task: {
      get say() {
        return text('layout', 'say')
      },
      done: { kind: 'state', target: 'layout', value: 'board' },
    },
  },
  {
    id: 'records',
    route: 'Applications',
    target: 'records',
    get title() {
      return text('records', 'title')
    },
    get body() {
      return text('records', 'body')
    },
  },
  {
    id: 'search',
    route: 'Applications',
    target: 'header:search',
    get title() {
      return text('search', 'title')
    },
    get body() {
      return text('search', 'body')
    },
    task: {
      get say() {
        return text('search', 'say')
      },
      done: { kind: 'route', route: 'Search' },
    },
  },
  {
    id: 'search-screen',
    route: 'Search',
    target: 'search-field',
    get title() {
      return text('searchScreen', 'title')
    },
    get body() {
      return text('searchScreen', 'body')
    },
  },
  {
    id: 'new',
    route: 'Applications',
    target: 'header:new',
    get title() {
      return text('new', 'title')
    },
    get body() {
      return text('new', 'body')
    },
  },
  {
    id: 'calendar',
    target: 'tab:Calendar',
    get title() {
      return text('calendar', 'title')
    },
    get body() {
      return text('calendar', 'body')
    },
    task: {
      get say() {
        return text('calendar', 'say')
      },
      done: { kind: 'route', route: 'Calendar' },
    },
  },
  {
    id: 'vault',
    target: 'tab:Vault',
    get title() {
      return text('vault', 'title')
    },
    get body() {
      return text('vault', 'body')
    },
    task: {
      get say() {
        return text('vault', 'say')
      },
      done: { kind: 'route', route: 'Vault' },
    },
  },
  {
    id: 'vault-tools',
    route: 'Vault',
    target: 'vault-tools',
    get title() {
      return text('vaultTools', 'title')
    },
    get body() {
      return text('vaultTools', 'body')
    },
    task: {
      get say() {
        return text('vaultTools', 'say')
      },
      done: { kind: 'state', target: 'vault-tools', value: 'files' },
    },
  },
  {
    id: 'files',
    route: 'Vault',
    target: 'files',
    get title() {
      return text('files', 'title')
    },
    get body() {
      return text('files', 'body')
    },
  },
  {
    id: 'more',
    target: 'tab:More',
    get title() {
      return text('more', 'title')
    },
    get body() {
      return text('more', 'body')
    },
    task: {
      get say() {
        return text('more', 'say')
      },
      done: { kind: 'route', route: 'More' },
    },
  },
  {
    id: 'scout',
    route: 'More',
    target: 'more:Job scout',
    get title() {
      return text('scout', 'title')
    },
    get body() {
      return text('scout', 'body')
    },
    task: {
      get say() {
        return text('scout', 'say')
      },
      done: { kind: 'route', route: 'JobScout' },
    },
  },
  {
    id: 'scout-screen',
    route: 'JobScout',
    get title() {
      return text('scoutScreen', 'title')
    },
    get body() {
      return text('scoutScreen', 'body')
    },
  },
  {
    id: 'statistics',
    route: 'More',
    target: 'more:Statistics',
    get title() {
      return text('statistics', 'title')
    },
    get body() {
      return text('statistics', 'body')
    },
    task: {
      get say() {
        return text('statistics', 'say')
      },
      done: { kind: 'route', route: 'Statistics' },
    },
  },
  {
    id: 'statistics-screen',
    route: 'Statistics',
    get title() {
      return text('statisticsScreen', 'title')
    },
    get body() {
      return text('statisticsScreen', 'body')
    },
  },
  {
    id: 'graph',
    route: 'More',
    target: 'more:Graph',
    get title() {
      return text('graph', 'title')
    },
    get body() {
      return text('graph', 'body')
    },
    task: {
      get say() {
        return text('graph', 'say')
      },
      done: { kind: 'route', route: 'Graph' },
    },
  },
  {
    id: 'graph-screen',
    route: 'Graph',
    get title() {
      return text('graphScreen', 'title')
    },
    get body() {
      return text('graphScreen', 'body')
    },
  },
  {
    id: 'assistant',
    route: 'More',
    target: 'more:Assistant',
    get title() {
      return text('assistant', 'title')
    },
    get body() {
      return text('assistant', 'body')
    },
  },
  {
    id: 'transfer',
    route: 'More',
    target: 'more:Transfer',
    get title() {
      return text('transfer', 'title')
    },
    get body() {
      return text('transfer', 'body')
    },
  },
  {
    id: 'settings',
    route: 'More',
    target: 'more:Settings',
    get title() {
      return text('settings', 'title')
    },
    get body() {
      return text('settings', 'body')
    },
    task: {
      get say() {
        return text('settings', 'say')
      },
      done: { kind: 'route', route: 'Settings' },
    },
  },
  {
    id: 'device',
    route: 'Settings',
    target: 'device',
    get title() {
      return text('device', 'title')
    },
    get body() {
      return text('device', 'body')
    },
  },
  {
    id: 'model',
    route: 'Settings',
    target: 'model',
    get title() {
      return text('model', 'title')
    },
    get body() {
      return text('model', 'body')
    },
  },
  {
    id: 'reader',
    route: 'Settings',
    target: 'reader',
    get title() {
      return text('reader', 'title')
    },
    get body() {
      return text('reader', 'body')
    },
  },
  {
    id: 'done',
    get title() {
      return text('done', 'title')
    },
    get body() {
      return text('done', 'body')
    },
  },
]
