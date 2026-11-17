/**
 * The pure half of Job scout's approval and promotion flow: what a suggestion
 * says the job is, the address a posting is opened at, and the words each
 * toast says. The hooks beside it (`use-proposal-actions.ts`,
 * `use-posting-actions.ts`, `use-fill-draft.ts`) do the writes; everything here
 * is a function of its arguments, so it is tested in `scout-approval.test.ts`.
 */
import { i18next } from '@/i18n/i18n'
import type { FillOutcome } from '@/lib/fill-from-posting'
import { scoutReading } from '@jojo/service/core/proposal'
import type { JobIdentity } from '@jojo/service/core/same-job'

/** The words are looked up when a toast is made, so they follow the language picked at the time. */
const t = (key: string, options?: Record<string, unknown>) => i18next.t(`scout:${key}`, options)

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
  return t('toasts.alreadyHaveDescription', {
    name: existing.role ? `${existing.org} — ${existing.role}` : existing.org,
  })
}

/** The toast for a posting that could not be read into its draft. */
export function fillFailedToast(
  org: string,
  out: Extract<FillOutcome, { ok: false }>,
): { title: string; description: string } {
  return {
    title: t('toasts.fillFailedTitle', { org }),
    description: out.kept
      ? t('toasts.fillFailedKept', { reason: out.reason })
      : t('toasts.fillFailed', { reason: out.reason }),
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
        ? t('toasts.filledTitle', { name })
        : t('toasts.checkedTitle', { name }),
    // Whole sentences, each one translated on its own; the field names in the
    // lists are the record's own and stay as they are.
    description: [
      out.filled.length > 0 ? t('toasts.filledIn', { list: out.filled.join(', ') }) : '',
      out.confirmed.length > 0 ? t('toasts.checked', { list: out.confirmed.join(', ') }) : '',
      out.keptYours.length > 0 ? t('toasts.keptYours', { list: out.keptYours.join(', ') }) : '',
      out.filled.length === 0 && out.confirmed.length === 0 ? t('toasts.addedNothing') : '',
      out.missing.length > 0 ? t('toasts.missing', { list: out.missing.join(', ') }) : '',
      t('toasts.filedUnder'),
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/** What one approval's "added as a draft" toast says, by whether there is a page and a model. */
export function approvedDescription(hasPage: boolean, configured: boolean): string {
  return hasPage
    ? configured
      ? t('toasts.approvedReading')
      : t('toasts.approvedFromLink')
    : t('toasts.approvedOpen')
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
      title: t('toasts.allRepeatsTitle'),
      description: t('toasts.allRepeats', { count: repeats }),
    }
  }
  if (done === 0) return null
  return {
    title:
      repeats > 0
        ? t('toasts.addedWithRepeats', { count: done, repeats })
        : t('toasts.added', { count: done }),
    description: configured ? t('toasts.addedReading') : t('toasts.addedFromLinks'),
  }
}
