import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * What a new arrival has already been shown.
 *
 * The phone's half of `web/src/lib/onboarding.ts`, in the same order: pick a
 * data set, say who you are, answer the reporting question, be offered the
 * tour. The
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
  /*
   * Connect a model — the stage the phone did not have.
   *
   * Web asks this between saying who you are and being shown around, and the
   * reason is the same on a phone: the tour describes an app that answers
   * questions and drafts letters, and someone walked through the assistant with
   * no model connected is being shown the scripted stand-in. Without this stage
   * the phone never mentioned a model during setup at all, so the only way to
   * find out the app had an assistant was to open it and read a canned reply
   * explaining why it could not help.
   *
   * It does NOT try to configure a model in the sheet the way web's step does.
   * That panel is a form with a URL, a key and a model list, and putting it
   * inside an onboarding sheet on a phone means typing a host address into a
   * keyboard-covered field before you have seen the app. It sends you to
   * Settings, which already does this properly, and remembers that it asked.
   */
  model: 'jojo/onboarding/model',
  /*
   * Crash reports and usage analytics, asked immediately before the tour.
   *
   * Before it rather than after, because the tour navigates away as soon as it
   * is accepted — a question asked afterwards is a question asked of the people
   * who declined the tour and nobody else. Same placement as the web flow.
   */
  reporting: 'jojo/onboarding/reporting',
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
    // Both lists derived from KEYS rather than spelled out. They were spelled
    // out, and adding a stage left the `multiGet` reading three keys of four
    // and the fallback missing one — `Record<OnboardingStage, boolean>` caught
    // the second and could never have caught the first, since a key simply not
    // asked for reads as "not offered" and re-asks a question already answered.
    const names = Object.keys(KEYS) as OnboardingStage[]
    const rows = await AsyncStorage.multiGet(names.map((name) => KEYS[name]))
    const map = new Map(rows)
    return Object.fromEntries(
      names.map((name) => [name, (map.get(KEYS[name]) ?? null) !== null]),
    ) as Record<OnboardingStage, boolean>
  } catch {
    return Object.fromEntries((Object.keys(KEYS) as OnboardingStage[]).map((n) => [n, false])) as Record<
      OnboardingStage,
      boolean
    >
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
