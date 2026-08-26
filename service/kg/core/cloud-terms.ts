/**
 * What a person is told before their records leave the device.
 *
 * ## Why this is data and not two screens
 *
 * It was two screens. Web's panel and the phone's Settings both wrote the
 * warning out in prose, both said in a comment that they were deliberately the
 * same words, and by the time anybody checked the phone was missing three
 * sentences — including the one saying that submitting content grants NVIDIA a
 * licence to store and reproduce it, and the one inviting the reader to go and
 * decide for themselves.
 *
 * That is a worse class of drift than a diverged button. Every other copy in
 * this app describes what the app does; this copy is the basis on which
 * somebody consents to sending their own and other people's personal
 * information to a third party. Two versions of it means one of them is a
 * consent notice that does not say what the other thought it did, and there is
 * no way to tell from either screen which.
 *
 * So the sentences live here, once, and each app renders them. The apps keep
 * their own layout and their own components — the phone has no `<span>` and the
 * web has no `<Txt>` — and neither has any prose of its own.
 *
 * ## Why segments rather than strings
 *
 * Web emphasises certain phrases inline: that some of the data is other
 * people's, and the two quotations from NVIDIA's terms. Flattening to plain
 * strings would silently drop that, and the emphasised phrases are precisely
 * the ones somebody skimming needs to catch. A segment carries the phrase and
 * whether it is emphasised; each app decides what emphasis looks like.
 */

import type { ProviderMeta } from './provider'

/** A run of text, and whether this app should make it stand out. */
export type Segment = { readonly text: string; readonly emphasis?: true }

export type CloudTerms = {
  /** The one line somebody reads if they read nothing else. */
  readonly headline: string
  /** Paragraphs, in order. Every one of them is shown. */
  readonly paragraphs: readonly (readonly Segment[])[]
  /** Who is party to the agreement. Always last, always shown. */
  readonly liability: readonly Segment[]
}

const plain = (text: string): Segment => ({ text })
const strong = (text: string): Segment => ({ text, emphasis: true })

/**
 * The notice for one provider.
 *
 * `name` is the provider's full label and `short` the same without the
 * parenthesised host — "NVIDIA (build.nvidia.com)" reads correctly in a
 * headline and badly in a possessive, which is the distinction both apps were
 * already making and is kept here so they cannot disagree about it either.
 */
export function cloudTerms(provider: ProviderMeta): CloudTerms {
  const name = provider.label.split(' —')[0] ?? provider.label
  const short = name.replace(/\s*\([^)]*\)\s*$/, '')

  const sent: readonly Segment[] = [
    plain(
      `Everything the assistant reads to answer you is sent to ${name}: your applications and notes, your profile, your CV text once a document is read, and the names and email addresses of any referees or recruiters it looks at. `,
    ),
    strong('Some of that is other people’s personal information, not just yours.'),
    plain(' jojo is local-first everywhere else; this is the one part that is not.'),
  ]

  const paragraphs: readonly Segment[][] = provider.evaluationOnly
    ? [
        [...sent],
        [
          plain('NVIDIA’s terms permit use '),
          strong('“for internal testing and evaluation purposes, not in production”'),
          plain(' without a subscription, and separately say you '),
          strong(
            '“will not upload any personal information relating to an identifiable individual”',
          ),
          plain(
            '. Tracking a real job search is production use, and the records above are personal information. Submitting content also grants NVIDIA a licence to store and reproduce it.',
          ),
        ],
        [
          plain(
            'It is free rather than billed — rate limited, and it refuses rather than charging you. Read the terms and decide for yourself whether your use fits them.',
          ),
        ],
      ]
    : [
        [...sent],
        [
          plain(
            `${short} is paid, billed to your account, and governed by its own terms — including what it may retain and whether prompts may be used to improve its models. That is a different bargain from the local option, not a worse one, but it is worth reading before your records are part of it.`,
          ),
        ],
      ]

  return {
    headline: provider.evaluationOnly
      ? `${name}: free, and licensed for evaluation only`
      : `Your records leave this device when you use ${name}`,
    paragraphs,
    liability: [
      plain(
        'You are the account holder and the party to that agreement — jojo ships no key and makes no request of its own. ',
      ),
      // Emphasised because it is the sentence that says whose problem a breach
      // is, and it is the one somebody skimming a warning box will skip.
      strong(
        `Compliance with ${short}’s terms is yours, and jojo accepts no liability for any breach of them.`,
      ),
    ],
  }
}
