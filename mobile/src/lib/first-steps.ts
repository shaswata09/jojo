/**
 * Whether the first-steps checklist is on screen, and the memory of saying no.
 *
 * ## The bug this replaces
 *
 * The panel latched open from `bare` — nothing added at all — and the latch was
 * component state. So somebody who added an application and closed the app came
 * back with the checklist gone and steps 2 and 3 never done, having been shown a
 * list of three things once and one of them completed. The dismiss button was
 * not remembered either, in the other direction: saying "hide these steps" and
 * then clearing the store brought it back.
 *
 * ## The rule
 *
 * Show it until it is FINISHED or DISMISSED. Those are different things and both
 * are permanent: finishing is a fact about the store, dismissing is a fact about
 * the person, and neither should be re-derived from how empty the store happens
 * to be on a given launch.
 *
 * Kept out of the screen because the screen cannot be mounted (D20), and this is
 * the part with a rule in it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { kgWarn } from '@jojo/service/log'

const KEY = 'jojo/first-steps/dismissed'

/** The three things the checklist asks for. */
export type FirstSteps = {
  readonly application: boolean
  readonly dated: boolean
  readonly reminder: boolean
}

export const allDone = (steps: FirstSteps): boolean =>
  steps.application && steps.dated && steps.reminder

/**
 * `null` while the stored answer is still being read.
 *
 * Three states, not two, and the third is what stops a flicker: AsyncStorage
 * cannot answer in the first render, and defaulting to "shown" flashes the
 * panel at everybody who dismissed it months ago, while defaulting to "hidden"
 * hides it for one frame from the person it is for.
 */
export function showFirstSteps(steps: FirstSteps, dismissed: boolean | null): boolean {
  if (dismissed === null) return false
  return !dismissed && !allDone(steps)
}

export async function readDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== null
  } catch (e) {
    // "Not dismissed", which shows the checklist. The safe direction: a person
    // who dismissed it sees it once more, rather than a new person never being
    // offered it at all.
    kgWarn('could not read whether the first-steps checklist was dismissed', { error: String(e) })
    return false
  }
}

export function markDismissed(): void {
  void AsyncStorage.setItem(KEY, new Date().toISOString()).catch((e: unknown) => {
    kgWarn('could not remember that the first-steps checklist was dismissed', {
      error: String(e),
    })
  })
}
