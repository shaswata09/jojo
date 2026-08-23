import { readStored, writeStored } from '@/lib/storage'

/**
 * What a new arrival has already been shown.
 *
 * Three things happen on a first run and they are deliberately three, in order:
 * pick a data set, say who you are, and be offered the tour. Each is a separate
 * question with a separate right answer, and stacking them into one dialog was
 * the first design and the wrong one — `FirstRunChoice`'s header argues at
 * length that it must be an undismissable fork between exactly two equal
 * options, and that argument stops being true the moment a third thing is in
 * the box with it.
 *
 * WHY LOCALSTORAGE AND NOT THE GRAPH. The same reasoning `tour/progress.ts`
 * gives, and it applies harder here: "has been offered a tour" is not a record
 * the user authored. In the graph it would show up in the audit log as a write
 * they did not make, ride along in every export and backup, cross to another
 * machine on Transfer, and be undoable with ⌘Z — which is absurd for a flag
 * about whether a dialog has been seen. It is a browser preference, so it lives
 * where the theme lives, through the guarded helpers: `localStorage` is a getter
 * that THROWS in blocked-storage browsers, and onboarding has to work in exactly
 * those.
 *
 * WHY EACH STAGE IS ITS OWN KEY rather than one JSON record. A record has to be
 * parsed, and a hand-edited or half-written one strands the reader somewhere —
 * the failure mode `readProgress` guards against by clamping. Separate keys have
 * no shape to get wrong: present or absent, and absent is always "not yet",
 * which is the safe direction. It also means adding a fourth stage later cannot
 * invalidate the three already stored.
 *
 * WHAT IS DELIBERATELY NOT STORED: whether the user actually filled the details
 * in. That question is answered by the profile itself — `useProfile().isBlank` —
 * and asking the data rather than a flag is what keeps the two from disagreeing.
 * These keys record only that we ASKED, so that skipping is respected and the
 * dialog does not come back every morning.
 */

const KEYS = {
  details: 'jojo.onboarding.details',
  tour: 'jojo.onboarding.tour',
} as const

export type OnboardingStage = keyof typeof KEYS

/** Has this stage been put in front of the user yet? */
export function wasOffered(stage: OnboardingStage): boolean {
  return readStored(KEYS[stage]) !== null
}

/**
 * Records that a stage has been shown, whatever the user did with it.
 *
 * Called when the dialog is dismissed as well as when it is completed, because
 * the thing being remembered is the asking. A stage marked only on success
 * would re-ask forever anyone who said no, which is the behaviour that teaches
 * people to dread launching an app.
 *
 * The timestamp is the value only because a key needs one; nothing reads it.
 * `writeStored` returns false in a browser that refuses to store, and that is
 * accepted rather than retried: the cost is being asked again next launch,
 * which is a better failure than a dialog that cannot be got past.
 */
export function markOffered(stage: OnboardingStage): void {
  writeStored(KEYS[stage], new Date().toISOString())
}
