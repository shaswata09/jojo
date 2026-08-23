import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * What a new arrival has already been shown.
 *
 * The phone's half of `web/src/lib/onboarding.ts`, and the same three stages in
 * the same order: pick a data set, say who you are, be offered the tour. The
 * reasoning for why they are three separate questions rather than one wizard is
 * on the web file and on `FirstRunChoice`; what differs here is only where the
 * flags live.
 *
 * WHY ASYNCSTORAGE AND NOT THE GRAPH. The same argument the web file makes:
 * "has been offered a tour" is not a record the user authored. In the graph it
 * would appear in the audit log as a write they did not make, ride along in a
 * backup, cross to the other device on Transfer, and be undoable. It is a
 * device preference, so it sits beside the model settings.
 *
 * WHY THE READS ARE ASYNC AND THE WEB'S ARE NOT. `localStorage` is synchronous
 * and AsyncStorage is not, which is a real difference rather than a style one:
 * the sequencer cannot decide what to show in its first render and has to hold
 * a "still asking" state. `null` is that state below — deliberately a third
 * value rather than defaulting to `false`, because defaulting would flash the
 * details sheet at every returning user for one frame before the read came back
 * and dismissed it.
 */

const KEYS = {
  details: 'jojo/onboarding/details',
  tour: 'jojo/onboarding/tour',
} as const

export type OnboardingStage = keyof typeof KEYS

/**
 * Which stages have been put in front of the user, or `null` while unknown.
 *
 * One `multiGet` rather than a read per stage, so the sequencer resolves in a
 * single tick and cannot render step three before step two has answered.
 *
 * A failed read is reported as "not offered", which asks again — the same
 * direction the web file chose, and the safe one: being asked twice is a small
 * annoyance, and never being asked means a profile that stays blank until a
 * cover letter prints `[YOUR NAME]`.
 */
export async function readOffered(): Promise<Record<OnboardingStage, boolean>> {
  try {
    const rows = await AsyncStorage.multiGet([KEYS.details, KEYS.tour])
    const map = new Map(rows)
    return {
      details: (map.get(KEYS.details) ?? null) !== null,
      tour: (map.get(KEYS.tour) ?? null) !== null,
    }
  } catch {
    return { details: false, tour: false }
  }
}

/**
 * Records that a stage has been shown, whatever the user did with it.
 *
 * Marked on dismissal as well as on completion, because the thing remembered is
 * the asking. Fire-and-forget: the sequencer has already advanced in memory, and
 * a failed write costs one repeat next launch rather than a stuck dialog.
 */
export function markOffered(stage: OnboardingStage): void {
  void AsyncStorage.setItem(KEYS[stage], new Date().toISOString()).catch(() => {})
}
