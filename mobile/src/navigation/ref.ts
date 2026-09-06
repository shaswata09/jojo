import { createNavigationContainerRef } from '@react-navigation/native'
import type { RootStackParamList } from '@/navigation/types'

/**
 * Navigation for the overlays that are mounted BESIDE the navigator.
 *
 * ## The crash this exists to stop
 *
 * Three things are rendered as siblings of `RootNavigator` rather than inside
 * it — `SheetHost`, `ApprovalSheet`, and the first-run overlays `StoreProvider`
 * owns — and every one of them is deliberate. A sheet is not a route, and
 * putting it under a screen tears it down the moment that screen navigates
 * away; an approval has to outlive the screen whose run raised it.
 *
 * The cost of that decision is that `useNavigation` THROWS in all three. It is
 * not a soft failure and it is not caught: React Navigation raises "Couldn't
 * find a navigation object. Is your component inside NavigationContainer?", the
 * error boundary catches it, and the person gets "Something broke — a screen
 * failed to draw" instead of the app. On a fresh install, choosing the demo
 * records swapped `FirstRunChoice` for `Onboarding`, `Onboarding` called
 * `useNavigation` on line one of its body, and the app died on the first thing
 * anybody pressed.
 *
 * ## Why a comment was not enough
 *
 * `SheetHost` already carried the rule in prose — "nothing reachable from here
 * may call `useNavigation`. None of the three does today." The words "today"
 * were doing real work and nobody updated them: `ApplicationSheet` grew a jump
 * to a duplicate record, `Onboarding` grew a "Set up a model" button, and both
 * reached for the hook that every screen in the app uses. Neither `tsc` nor
 * `oxlint` can see the difference, because the hook is correct code in the
 * wrong place.
 *
 * So the rule gets a mechanism instead of a sentence. `check-overlays.mjs`
 * fails the build when a module reachable from an overlay imports
 * `useNavigation`, and this ref is what those modules use instead.
 *
 * ## Why it is module scope
 *
 * `useNavigationContainerRef` makes a ref per mount, reachable only by whatever
 * is inside that component — which is exactly the tree these overlays are not
 * in. `createNavigationContainerRef` is React Navigation's own answer for
 * navigating from outside the tree, and one container means one ref is honest.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/**
 * Run a navigation, or do nothing if the container has not mounted yet.
 *
 * The guard is not defensive padding. These overlays draw during boot — the
 * first-run choice is on screen before the navigator has finished mounting —
 * and `navigate` on an unready ref throws its own error, which would trade this
 * crash for a less obvious one. Doing nothing is right: the button that could
 * not navigate is on a screen the person is about to leave anyway.
 *
 * Takes a callback rather than re-exporting `navigate`, because `navigate` is
 * overloaded on whether a screen takes params and forwarding it through a
 * wrapper collapses those overloads into the last one — which typechecks the
 * calls that pass params and rejects the ones that do not.
 */
export function fromOverlay(
  run: (nav: typeof navigationRef & { isReady: () => true }) => void,
): void {
  if (!navigationRef.isReady()) return
  run(navigationRef as typeof navigationRef & { isReady: () => true })
}
