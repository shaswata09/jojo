/**
 * The pure half of Job scout's approval and promotion flow: what a suggestion
 * says the job is, the address a posting is opened at, and the words each
 * toast says. The hooks beside it (`use-proposal-actions.ts`,
 * `use-posting-actions.ts`, `use-fill-draft.ts`) do the writes; everything here
 * is a function of its arguments, so it is tested in `scout-approval.test.ts`.
 */
import type { FillOutcome } from '@/lib/fill-from-posting'
import { scoutReading } from '@jojo/service/core/proposal'
import type { JobIdentity } from '@jojo/service/core/same-job'

/** What a scout suggestion says the job is. */
export function identityOf(input: string, reading?: string): JobIdentity {
  // What the page said beats what the listing said, where the page was read.
  const read = scoutReading(reading)
  const page = read?.ok ? read.fields : {}
  try {
    const raw = JSON.parse(input) as Record<string, unknown>
    const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : undefined)
    return {
      org: page.org ?? text('org'),
      role: page.role ?? text('title'),
      location: page.location ?? text('location'),
      url: text('url'),
      postingId: page.postingId,
    }
  } catch {
    return {}
  }
}

/** Seeded and pasted postings are often stored without a scheme ('jobs.rice.edu/…'). */
export function withScheme(typed: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`
}

/** Said once a job turned out to be one already in the applications. */
export function alreadyHaveDescription(existing: { org: string; role: string }): string {
  return `This is ${existing.role ? `${existing.org} — ${existing.role}` : existing.org}, reposted on another board. The posting is linked to it, and its page is filed under it.`
}

/** The toast for a posting that could not be read into its draft. */
export function fillFailedToast(
  org: string,
  out: Extract<FillOutcome, { ok: false }>,
): { title: string; description: string } {
  return {
    title: `${org}: the posting could not be read`,
    description: out.kept
      ? `${out.reason} The page itself was saved and filed under the draft — open it to fill in the rest.`
      : `${out.reason} The draft keeps what its link says — open it to fill in the rest.`,
  }
}

/** The toast for a posting read into its draft — what it filled, checked, kept and missed. */
export function fillDoneToast(out: Extract<FillOutcome, { ok: true }>): {
  title: string
  description: string
} {
  const name = out.name
  return {
    title:
      out.filled.length > 0
        ? `${name} filled from the posting`
        : `${name} checked against the posting`,
    description: [
      out.filled.length > 0 ? `Filled in: ${out.filled.join(', ')}.` : '',
      out.confirmed.length > 0 ? `Checked against the page: ${out.confirmed.join(', ')}.` : '',
      out.keptYours.length > 0 ? `Kept your edits to: ${out.keptYours.join(', ')}.` : '',
      out.filled.length === 0 && out.confirmed.length === 0
        ? 'The page added nothing the draft did not have.'
        : '',
      out.missing.length > 0 ? `Not on the page: ${out.missing.join(', ')}.` : '',
      'The page is filed under it.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/** What one approval's "added as a draft" toast says, by whether there is a page and a model. */
export function approvedDescription(hasPage: boolean, configured: boolean): string {
  return hasPage
    ? configured
      ? 'Reading the posting to fill in its details — the draft updates when it is done.'
      : 'Filled from its link. Connect a model in Settings to have the posting itself read in.'
    : 'Open it to fill in the rest.'
}

/**
 * What Approve all says, given how many became drafts and how many were jobs
 * already in the applications. Null when there is nothing to say.
 */
export function approveAllToast(
  done: number,
  repeats: number,
  configured: boolean,
): { title: string; description: string } | null {
  if (done === 0 && repeats > 0) {
    return {
      title: `Already in your applications — nothing new added`,
      description: `${String(repeats)} ${repeats === 1 ? 'is a job' : 'are jobs'} you already have, reposted on another board. ${repeats === 1 ? 'It is' : 'They are'} linked to the application${repeats === 1 ? '' : 's'} you have.`,
    }
  }
  if (done === 0) return null
  return {
    title: `${String(done)} added to your applications as drafts${repeats > 0 ? ` · ${String(repeats)} already there` : ''}`,
    description: configured
      ? 'Reading each posting in turn to fill in its details.'
      : 'Filled from their links. Connect a model in Settings to have the postings themselves read in.',
  }
}
