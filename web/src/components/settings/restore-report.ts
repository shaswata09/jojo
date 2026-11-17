/**
 * What to say after a restore has already happened.
 *
 * Separated from the panel for the reason `export-name.ts` is: the sentence is
 * the part that can be wrong, and a sentence in a `.tsx` is a sentence with no
 * test. What can be wrong here is specific — a restore that dropped records
 * reporting only the ones it kept — so that case gets its own shape below and
 * its own cases in the test beside it.
 *
 * THE NUMBERS ARE NOT INTERCHANGEABLE and the bug came from treating them as if
 * they were. `held` counts the records in the FILE. `nodes` counts what was
 * WRITTEN. `skipped` is the validator's own tally and counts rows of both kinds
 * — a record that failed and a link that failed are one number there — so it
 * says whether anything was refused but never how many records. The records
 * lost are `held - nodes`, and nothing else in the outcome can stand in for it.
 */

import { i18next } from '@/i18n/i18n'

/** What a finished restore did, as the panel needs to describe it. */
export type RestoreReport = {
  /** Records the file held. `RestorePlan.nodes.length`, counted before the write. */
  held: number
  /** Records actually written. */
  nodes: number
  /** Documents actually written. */
  documents: number
  /** Rows the validator refused — records and links together. */
  skipped: number
}

export type RestoreSummary = {
  title: string
  description: string
  /** Danger whenever anything in the file did not survive the crossing. */
  tone?: 'danger'
}

/** A count with its noun, in the reader's language and plural rules. */
const count = (key: 'records' | 'documents' | 'links', n: number) =>
  i18next.t(`settings:restore.count.${key}`, { count: n })

/**
 * The outcome in words, and the honest version is the interesting one.
 *
 * Three shapes rather than one sentence with clauses bolted on, because the
 * three say genuinely different things to the person reading them:
 *
 *   nothing lost      — a confirmation, and it can be brief
 *   records lost      — the file held records this build could not read, and
 *                       they are not on this device. That is not a footnote to
 *                       a success message; it is the message.
 *   only links lost   — every record survived and some of the pointers between
 *                       them did not, which shows up as a file that is filed
 *                       under nothing rather than a file that is missing.
 *
 * The lost count leads with what the file held, because a number on its own
 * ("87 records are back") reads as a success to someone who has no idea it was
 * meant to be 275.
 */
export function restoreSummary(r: RestoreReport): RestoreSummary {
  const lost = Math.max(0, r.held - r.nodes)
  // Two sentences rather than an optional clause spliced in: where "and 3
  // documents" goes in a sentence is the language's decision, not this code's.
  const withDocs = r.documents > 0
  const documents = withDocs ? count('documents', r.documents) : ''

  if (lost > 0) {
    return {
      title: i18next.t('settings:restore.lost.title'),
      description: i18next.t(
        withDocs
          ? 'settings:restore.lost.descriptionWithDocuments'
          : 'settings:restore.lost.description',
        {
          held: count('records', r.held),
          kept: count('records', r.nodes),
          documents,
          lost: String(lost),
        },
      ),
      tone: 'danger',
    }
  }

  if (r.skipped > 0) {
    return {
      title: i18next.t('settings:restore.withoutLinks.title'),
      description: i18next.t(
        withDocs
          ? 'settings:restore.withoutLinks.descriptionWithDocuments'
          : 'settings:restore.withoutLinks.description',
        { held: count('records', r.held), documents, links: count('links', r.skipped) },
      ),
      tone: 'danger',
    }
  }

  return {
    title: i18next.t('settings:restore.done.title'),
    description: i18next.t(
      withDocs
        ? 'settings:restore.done.descriptionWithDocuments'
        : 'settings:restore.done.description',
      { records: count('records', r.nodes), documents },
    ),
  }
}
