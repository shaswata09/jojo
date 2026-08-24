import { readStored, removeStored, writeStored } from '@/lib/storage'

/**
 * What a new arrival has already been shown.
 *
 * Six things happen on a first run and they are deliberately six, in order: pick
 * a data set, say who you are, connect a model, point at a document reader,
 * install the capture extension, and be offered the tour. Each is a separate
 * question with a separate right answer, and stacking them into one dialog was
 * the first design and the wrong one — `FirstRunChoice`'s header argues at
 * length that it must be an undismissable fork between exactly two equal
 * options, and that argument stops being true the moment a third thing is in
 * the box with it.
 *
 * The three in the middle are SETUP rather than questions about the user, and
 * they are the ones that turn jojo from a tracker into something that can work
 * on the search: a model is what the assistant and the pipelines run on, the
 * reader is what lets the agent see inside a PDF rather than only its filename,
 * and the extension is what lets a posting be kept and a job board be read.
 * Every one of them is optional, individually, and the app is honest without
 * any of them — which is why each is its own dismissable step rather than a
 * wizard nobody can leave.
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
  /** Connect a model, so the assistant and the pipelines can actually run. */
  model: 'jojo.onboarding.model',
  /** Run MarkItDown, so the agent can read inside documents. Model-only. */
  reader: 'jojo.onboarding.reader',
  /** Install the capture extension. Nothing to do with the model. */
  extension: 'jojo.onboarding.extension',
  /*
   * Its own key like every other stage, so answering it once is remembered even
   * though the answer it stores lives elsewhere. Without this the question
   * would be asked again on every launch of a browser where the answer was no —
   * and a consent question that keeps asking until it gets a yes is not a
   * consent question.
   */
  crash: 'jojo.onboarding.crash',
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

/* --- the dashboard's checklist ---------------------------------------------- */

/**
 * The first-steps card, which is a PANEL and not one of the six above.
 *
 * Its own keys and its own functions rather than two more entries in `KEYS`,
 * because that type drives an exhaustive `Record<OnboardingStage, …>` in
 * `Onboarding.tsx` — the dialog sequencer — and a dashboard panel has no place
 * in it. Same storage, same guarded helpers, different question.
 *
 * WHY IT NEEDED PERSISTING AT ALL. The card was latched per mount: it opened on
 * a bare store and closed when the user closed it, and unmounted when they left
 * the dashboard. So the obvious first move — click Applications in the sidebar,
 * add the first job there, come back — destroyed it at 1 of 3, permanently, and
 * the two steps the reader had not seen yet went with it. The exploring user is
 * the one who needs steps 2 and 3, and they were exactly the user who lost them.
 *
 * WHY TWO KEYS AND NOT ONE. Three states have to be told apart, and only two of
 * them are the user's doing:
 *
 *   never opened  — an established install that was never bare. Must not be
 *                   shown a getting-started card with all three already ticked.
 *   opened        — was bare once and has not been dismissed. Survives leaving
 *                   the page, which is the whole point.
 *   closed        — the user pressed the button. Stays shut.
 *
 * One key cannot carry that without a value to parse, and this file argues at
 * length above for keys whose whole meaning is present-or-absent.
 */
const CHECKLIST = {
  opened: 'jojo.onboarding.checklist.opened',
  closed: 'jojo.onboarding.checklist.closed',
} as const

/** Has the store ever been bare while this browser was watching? */
export const checklistOpened = (): boolean => readStored(CHECKLIST.opened) !== null

/** Has the user dismissed it? */
export const checklistClosed = (): boolean => readStored(CHECKLIST.closed) !== null

/**
 * Marks the checklist as begun, and un-dismisses it.
 *
 * The second half is what makes "Clear everything" in Settings land the user
 * back on a dashboard that offers to walk them through it again — the same
 * behaviour the per-mount latch had, kept rather than lost to persistence.
 */
export function openChecklist(): void {
  writeStored(CHECKLIST.opened, new Date().toISOString())
  removeStored(CHECKLIST.closed)
}

export function closeChecklist(): void {
  writeStored(CHECKLIST.closed, new Date().toISOString())
}
