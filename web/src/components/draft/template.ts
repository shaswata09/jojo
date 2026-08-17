/**
 * The snippet template engine: what a blank looks like, and what fills it.
 *
 * Extracted from `DraftDialog.tsx`, where it sat above the dialog's own state
 * and markup. Nothing in it renders — it is a rule about what this app is
 * willing to guess on the user's behalf, which is a policy decision and not a
 * presentation one, and the comment on `fillsFor` is the argument for it.
 *
 * The concrete task this unblocks: `BLANK` is a regex that decides which
 * bracketed text in someone's own writing counts as a token to overwrite. It
 * had no test, because reaching it meant mounting a dialog. The boundary cases
 * that matter — "[see attached]" must NOT be treated as a blank, "[YOUR NAME]"
 * must — are now assertable.
 *
 * WHERE THIS SHOULD END UP: the service layer, as `kg/core/template.ts`. It is
 * pure and clock-free, and a second front end fills the same tokens from the
 * same records. `hostOf` is the one import that does not belong there yet — it
 * comes from `vault/links/url.ts`, which is itself a second URL vocabulary
 * beside `kg/core/parse-posting.ts` and needs reconciling first.
 */

import { hostOf } from '@/components/vault/links/url'
import type { Application } from '@/data/seed'
import { shortDate } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'

/**
 * A blank in a snippet: `[NAME]`, `[YOUR NAME]`, `[LOCAL CONTEXT]`.
 *
 * Upper case with an optional space is the convention every seeded snippet
 * already follows, and it is narrow enough that a bracketed aside someone types
 * into their own draft — "[see attached]" — is not mistaken for one.
 */
export const BLANK = /\[[A-Z][A-Z0-9 '/-]*\]/g

/**
 * What the records actually know, keyed by the token that asks for it.
 *
 * Everything absent from this map stays on the page as a visible blank. That is
 * the whole design: `[NAME]` is never filled, because the store holds no
 * recruiter's name and a *plausible* one — inferred from a note, or borrowed
 * from a nearby contact link — is exactly the kind of thing that gets sent by
 * accident and addresses a search chair as the wrong person. A blank is
 * impossible to send without noticing. A confident guess is not.
 */
export function fillsFor(app?: Application, item?: TimelineItem): Record<string, string> {
  const fills: Record<string, string> = {}
  if (app) {
    fills.ROLE = app.role
    fills.POSITION = app.role
    fills.ORG = app.org
    fills.EMPLOYER = app.org
    fills.COMPANY = app.org
    fills.INSTITUTION = app.org

    const sent = app.submittedOn ?? app.appliedOn
    if (sent) fills.DATE = shortDate(sent)

    const portal = app.url === undefined ? undefined : hostOf(app.url)
    if (portal) fills.PORTAL = portal
  }

  // One token, two questions. In a chase — "I submitted it on [DATE]" — it is
  // the day the application went in. In a thank-you it is the day you met, and
  // for that the item is the record that knows, not the application. Getting
  // this backwards produces a wrong date rather than a missing one, which is
  // the worse failure, so the kind decides and the application only fills in
  // for the chase.
  if (item && (item.kind === 'interview' || item.kind === 'visit' || item.kind === 'call')) {
    fills.DATE = shortDate(item.date)
  }

  return fills
}

export const applyFills = (body: string, fills: Record<string, string>) =>
  body.replace(BLANK, (token) => fills[token.slice(1, -1)] ?? token)

/** Every blank still in the text, in the order they first appear. */
export function blanksIn(text: string) {
  const found = text.match(BLANK) ?? []
  return { count: found.length, names: [...new Set(found)] }
}
