import { Link } from 'react-router'
import { cloudTerms } from '@jojo/service/core/cloud-terms'
import { guidePath } from '@/lib/links'
import type { ProviderMeta } from '@jojo/service/core/provider'

/**
 * What choosing this provider actually commits you to.
 *
 * Shown the instant the dropdown changes, in Settings AND in the first-run
 * tutorial — they are the same component, and the tutorial is where most people
 * make this choice for the first time. A disclosure that only appears in
 * Settings is one most users meet after they have already sent their CV.
 *
 * THREE THINGS, in the order they matter to the person reading:
 *
 * 1. What leaves. Named as records rather than "data", because "your data" is
 *    a phrase people skim. Applications, notes, CV text, and the names and email
 *    addresses of referees and recruiters — those last are somebody ELSE's
 *    personal details, which is the part nobody thinks about.
 * 2. What it costs — money, or a licence that does not permit this use.
 * 3. Who carries the consequence. jojo is not a party to the agreement: it ships
 *    no key and makes no call of its own, so the account, the bill and any
 *    breach are the user's. Saying so is not a disclaimer to hide behind, it is
 *    the accurate description of who signed what.
 *
 * NVIDIA GETS ITS OWN TREATMENT because its terms differ in kind, not degree:
 * the free tier is licensed for evaluation and NOT production, and it forbids
 * uploading personal data — which is most of what the assistant sends. Every
 * other provider here sells production use; that is what the bill is for.
 */
export function CloudTerms({ provider }: { provider: ProviderMeta }) {
  const terms = cloudTerms(provider)

  // The dropdown entry reads "NVIDIA (build.nvidia.com) — free, rate limited",
  // which is right in a list and a stammer inside a sentence about to repeat it.
  const name = provider.label.split(' —')[0] ?? provider.label
  /*
   * Without the parenthetical, for the two places the full name reads badly: a
   * possessive ("NVIDIA (build.nvidia.com)'s terms") and a link label, where the
   * address is noise because the link goes there anyway. The full name stays in
   * the headline and the first mention, where identifying WHICH NVIDIA endpoint
   * is the useful part.
   */
  const short = name.replace(/\s*\([^)]*\)\s*$/, '')

  return (
    <div className="mt-2 rounded-md border border-warning-border bg-warning-soft p-2.5">
      <p className="text-xs font-medium text-warning">{terms.headline}</p>

      {/* Rendered from `core/cloud-terms.ts`, not written here. Both apps used
          to hold this prose and both said in a comment that they were saying
          the same thing; by the time anyone checked, the phone was three
          sentences short — including the NVIDIA storage licence. A consent
          notice is the one piece of copy where two versions means one of them
          is not what the reader was told. */}
      <div className="mt-1.5 space-y-1.5 text-xs text-text-2">
        {terms.paragraphs.map((paragraph, i) => (
          <p key={i}>
            {paragraph.map((segment, j) =>
              segment.emphasis === true ? (
                <span key={j} className="text-text-1">
                  {segment.text}
                </span>
              ) : (
                <span key={j}>{segment.text}</span>
              ),
            )}
          </p>
        ))}

        <p className="text-text-3">
          {terms.liability.map((segment, j) =>
            segment.emphasis === true ? (
              <span key={j} className="text-text-1">
                {segment.text}
              </span>
            ) : (
              <span key={j}>{segment.text}</span>
            ),
          )}
        </p>

        <p className="flex flex-wrap gap-x-3 gap-y-1">
          <a
            href={provider.termsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-1 underline-offset-4"
          >
            {short} terms
          </a>
          <a
            href={provider.privacyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-1 underline-offset-4"
          >
            Privacy policy
          </a>
          <Link
            to={guidePath('licence')}
            className="text-accent underline decoration-1 underline-offset-4"
          >
            jojo’s licence page
          </Link>
        </p>
      </div>
    </div>
  )
}
