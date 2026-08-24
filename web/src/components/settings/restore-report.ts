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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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
  const docs = r.documents === 0 ? '' : ` and ${plural(r.documents, 'document')}`

  if (lost > 0) {
    return {
      title: 'Some records could not be restored',
      description:
        `That file held ${plural(r.held, 'record')}. ${plural(r.nodes, 'record')}${docs} ` +
        `are on this device and ${String(lost)} could not be read — those are gone. ` +
        'The file itself is unchanged, so a build that can read them can still restore it.',
      tone: 'danger',
    }
  }

  if (r.skipped > 0) {
    return {
      title: 'Restored, without some links',
      description:
        `All ${plural(r.held, 'record')}${docs} are back. ${plural(r.skipped, 'link')} between them ` +
        'could not be read, so a few documents, reminders or postings may not be filed under the ' +
        'job they belonged to. Nothing else is missing.',
      tone: 'danger',
    }
  }

  return {
    title: 'Restored',
    description: `${plural(r.nodes, 'record')}${docs} are back, exactly as the file held them.`,
  }
}
