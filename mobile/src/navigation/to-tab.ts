import type { NavigationAction } from '@react-navigation/native'
import type { TabParamList } from '@/navigation/types'

/**
 * Go to one of the tabs from anywhere — a tab, a stack screen, an overlay.
 *
 * ## Why not `navigate('Tabs', …)`
 *
 * Since React Navigation 7 a stack's NAVIGATE reuses a route only when it is
 * the CURRENT one. From Search, Graph, a record or any other root-stack screen,
 * `navigate('Tabs', { screen })` therefore pushed a second copy of the whole
 * tab navigator — a fresh Today, a fresh Vault — on top of the screen you came
 * from, and Back led to Search rather than to the tabs. Each pass through
 * Search added another layer, without limit (measured against the real
 * router: `Tabs > Search > Tabs > Search > Tabs > Search > Tabs`).
 *
 * POP_TO goes BACK to the `Tabs` already at the bottom of the stack, dropping
 * what is above it, and hands the nested `{ screen, params }` down so the tab
 * navigator switches. From a tab it is the same as navigate: the current route
 * is `Tabs`, so nothing is popped. The tour reached for this first; every tab
 * hop now goes through here.
 *
 * ## Why the action is built by hand
 *
 * `StackActions` lives in `@react-navigation/native`, which loads React Native,
 * and two callers (`search-places.ts`, `destinations.ts`) are imported by the
 * node test runner. The object below is the one `StackActions.popTo` returns,
 * and `to-tab.test.ts` checks that against the router itself.
 */
export function tabAction<S extends keyof TabParamList>(
  screen: S,
  params?: TabParamList[S],
): NavigationAction {
  return {
    type: 'POP_TO',
    payload: { name: 'Tabs', params: params === undefined ? { screen } : { screen, params } },
  }
}

/** Anything that can dispatch: a screen's navigation prop, or `navigationRef`. */
type Dispatcher = { dispatch: (action: NavigationAction) => void }

/** Goes to a tab, back down the stack rather than pushing a second tab navigator. */
export function toTab<S extends keyof TabParamList>(
  nav: Dispatcher,
  screen: S,
  params?: TabParamList[S],
): void {
  nav.dispatch(tabAction(screen, params))
}
