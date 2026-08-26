/**
 * The seed the session store starts from.
 *
 * Transcribed from the design mockup. Nothing here is mutated in place, and
 * nothing here is state: these arrays are read exactly twice, by `repo/seed.ts`
 * and by the `memory.reset` tool, each of which COMPILES them into graph nodes.
 * Every edit the user makes lands on those nodes. (This paragraph used to say
 * the arrays were "the initial value handed to `StoreProvider`" and that edits
 * lived "in that reducer" — there has been no reducer since Wave 1, and the
 * provider never saw the fixtures.)
 *
 * Fixtures only, as of the KG layer. The domain types moved DOWN to
 * `kg/core/model` and are re-exported here, so every existing import still
 * resolves — but the model no longer depends on this file, and a demo record is
 * no longer the definition of what a record is. There is deliberately no badge
 * field on an application: rows used to carry a hand-authored `chips` array —
 * `offer`, `prep due`, `24d left` — rendered with the same component as the
 * user's keywords, so a tag the app invented was indistinguishable from one the
 * user chose. Everything it carried is derived elsewhere now.
 */

import { shortDate } from '../kg/core/dates'
import type { Application, Offer, Period, Stage } from '../kg/core/model'
import { STAGE_LABEL, STAGE_VALUES } from '../kg/core/model'

export { ROLES, SOURCES, STAGE_LABEL } from '../kg/core/model'
/* `offerDaysLeft` followed `kg/react/use-priority.ts`, its only reader outside
 * this file's own callers, down into `kg/core/dates.ts`. `respondByLabel` below
 * stayed: nothing under `service/kg` asks for it. */
export { offerDaysLeft } from '../kg/core/dates'
export type {
  Application,
  Offer,
  OfferApplication,
  Outcome,
  RoleTag,
  Source,
  Stage,
  Urgency,
} from '../kg/core/model'

/**
 * 'Stripe — ML engineer' — an em dash with spaces either side.
 *
 * Byte-identical to the packed string the split replaced, so every existing
 * render stays as it was.
 */
/**
 * 'Rice — Assistant professor', or just 'Rice'.
 *
 * Only the employer is required on an application, and a posting promoted from
 * a URL that names no job ('jobs.rice.edu/postings/29411') arrives with the
 * role blank. Interpolating it regardless left a dangling separator on the end
 * of the name — punctuation promising a second half that is not there.
 */
// Moved to `kg/core/model.ts` and re-exported here, where every caller already
// looks for it. It moved because `kg/core/stage-policy.ts` needs it and core
// may not import `data/` — see DATA_READERS in `check-layers.mjs`.
export { displayName } from '../kg/core/model'
import { displayName } from '../kg/core/model'

/**
 * 'Rice — ML engineer and Baylor', or '5 applications'. Empty for none.
 *
 * `FILED_UNDER` and `ABOUT` are many-to-many, so every surface that names what
 * a record is filed under has the same list to render and the same place to
 * stop rendering it: two names is worth reading, and "Rice, Baylor, UH, UNT
 * and Stripe" is longer than the control it has to fit in. A picker trigger on
 * a phone, a combobox trigger in a narrow web column and four toasts all drew
 * that line for themselves; this is the one place it is drawn.
 *
 * Takes applications rather than ids because the caller is the one holding the
 * index, and an id whose record has gone should vanish from the list rather
 * than turn into a blank between two commas.
 */
export function applicationsLabel(apps: readonly Pick<Application, 'org' | 'role'>[]) {
  if (apps.length === 0) return ''
  if (apps.length <= 2) return apps.map(displayName).join(' and ')
  return `${String(apps.length)} applications`
}

/** 'filed under Rice and Baylor', or 'unfiled'. For the toast that confirms it. */
export function filedUnderLabel(apps: readonly Pick<Application, 'org' | 'role'>[]) {
  return apps.length === 0 ? 'unfiled' : `filed under ${applicationsLabel(apps)}`
}

/** 'Nov 15'. */
export function respondByLabel(offer: Offer) {
  return shortDate(offer.respondBy)
}


/*
 * `STAGE_LABEL` moved to `kg/core/model.ts`, beside the `STAGE_VALUES` union it
 * annotates, and is re-exported below so the 52 modules importing it from here
 * did not move. It left because `kg/tools/support.ts` had to re-export it in
 * turn — the model's own prose for its own enum was filed under demo data, and
 * two layers of the service layer reached through the `@/data` alias to read six
 * words. `STAGE_DOT` has now left too, in the other direction: its values are
 * Tailwind class names, so a package compiled into React Native was shipping
 * six strings that mean nothing there. It lives in `web/src/data/seed.ts`,
 * which re-exports this file, so every web caller's import is unchanged and the
 * phone no longer carries it. `scripts/check-platform.mjs` keeps it out.
 */


/**
 * The six stages in funnel order, which is the order the board columns, the
 * pipeline bar and the stage menu all read in.
 *
 * Derived from `STAGE_VALUES` rather than listed again, so the order is the
 * model's and the lookup above is the only place a stage's prose lives.
 * `STAGE_VALUES` is where a stage is added; the compiler then asks for its
 * label before this file will build.
 *
 * NO `dot`. It carried one, whose value was a Tailwind class — so every mobile
 * screen importing this list compiled a field it cannot use, and the portable
 * package described a stage in a language only one of its two apps speaks.
 * `web/src/data/seed.ts` adds it back for web, where it means something.
 */
export const STAGES: { id: Stage; label: string }[] = STAGE_VALUES.map((id) => ({
  id,
  label: STAGE_LABEL[id],
}))

/**
 * A frozen `frequencyByPeriod` table used to sit here — three ranges of
 * hand-authored counts, with a `RoleBucket` type and a `bucket()` constructor
 * that existed only to build it. `ApplicationFrequency` counts the real records
 * now and has said so in a past-tense comment for two waves, while the table it
 * replaced stayed exported with no consumer at all. Deleted.
 */
export type { Period } from '../kg/core/model'

/**
 * The labelled list a segmented control renders. The VALUES moved down to
 * `core/model.ts` as `PERIOD_VALUES` when `core/frequency.ts` arrived — core
 * buckets by them and may not read a fixture — so what is left here is the copy,
 * which is app-facing and belongs beside the rest of the demo content.
 */
export const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]
