/**
 * What a person is told before their records leave the device.
 *
 * ## Why this is data and not two screens
 *
 * It was two screens. Web's panel and the phone's Settings both wrote the
 * warning out in prose, both said in a comment that they were deliberately the
 * same words, and by the time anybody checked the phone was missing three
 * sentences — including the one saying what a provider may retain, and the one
 * saying whose agreement it is.
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
 * ## Why it takes a translator
 *
 * It was English in all twenty languages: both apps rendered `headline` and the
 * paragraphs straight from here, with no `t()` anywhere on the path, so the one
 * notice a person is meant to understand before agreeing to something was the
 * one notice a Japanese or Arabic reader got in a language they may not read.
 *
 * The seam is the one `domain-text.ts` and `advice-text.ts` use. Core may not
 * import i18next and does not need to: the English lives here as
 * `CLOUD_TERMS_EN`, the function takes a `Translate`, and each app passes its
 * own i18next bound to wherever the keys sit in its catalogs (`settings` on
 * the web, `screens` → `settings` on the phone). Left out, the translator is
 * this English, which is what the tests and anything outside an app read.
 *
 * Every sentence is a whole key, with the provider's name as a placeholder, so
 * a language can put the name where its grammar wants it.
 *
 * ## Why segments rather than strings
 *
 * Web emphasises certain phrases inline: that some of the data is other
 * people's, and whose problem a breach of the provider's terms is. Flattening to plain
 * strings would silently drop that, and the emphasised phrases are precisely
 * the ones somebody skimming needs to catch. A segment carries the phrase and
 * whether it is emphasised; each app decides what emphasis looks like.
 */

import { englishTranslator } from './domain-text'
import type { Translate } from './domain-text'
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

/**
 * The notice, in English, keyed as the apps' catalogs hold it.
 *
 * `{{name}}` is the provider's full label ("Anthropic (Claude)") and
 * `{{short}}` the same without the parenthesis ("Anthropic"), for the
 * possessives and the places the full name reads badly.
 *
 * Each app's English catalog holds this object under `cloudNotice` (web:
 * `settings.json`; phone: `screens.json` → `settings.cloudNotice`), and a test
 * beside each app's renderer holds the two equal, so a sentence changed here
 * without the catalog fails instead of shipping two Englishes.
 */
export const CLOUD_TERMS_EN = {
  headline: 'Your records leave this device when you use {{name}}',
  sent: {
    what: 'Everything the assistant reads to answer you is sent to {{name}}: your applications and notes, your profile, your CV text once a document is read, and the names and email addresses of any referees or recruiters it looks at.',
    others: 'Some of that is other people’s personal information, not just yours.',
    local: 'With a model on your own machine instead, none of it leaves.',
  },
  /*
   * Not only the chat. The duplicate check at Save, the scout's readings of
   * the postings it finds, fit readings, tailoring and compaction all use the
   * selected model, and each sends records. A notice that said "when you use
   * the assistant" let somebody believe that not opening the chat kept their
   * records home.
   */
  background:
    'It is not only when you chat. While {{name}} is selected, jojo also sends it records for work done in the background: the duplicate check when you save an application, reading the postings your scout finds, fit readings against your profile, tailoring your CV and letters, and shortening a long conversation so it fits.',
  cost: {
    paid: '{{short}} bills your account, and its own terms govern what it may keep and whether what you send may be used to improve its models.',
    freeTier:
      '{{short}} has a free tier with limits as well as paid use billed to your account. Either way its own terms govern what it may keep and whether what you send may be used to improve its models.',
    bargain:
      'That is a different bargain from the local option, not a worse one, but it is worth reading before your records are part of it.',
  },
  /*
   * OpenRouter is a router: the request is handed on to the company whose
   * model was picked, so there are two sets of terms, not one — and its own
   * let it keep requests and use their content in anonymised form.
   */
  openrouter:
    'OpenRouter passes each request on to the company that makes the model you pick, under that company’s terms as well as its own. OpenRouter’s own terms let it log requests and use their content in anonymised form.',
  /*
   * Neutral on purpose. These are API terms written for businesses and
   * developers, and whether a person's own job search fits them is a question
   * this app cannot answer for anybody — so it says that, rather than either
   * reassuring or warning.
   */
  business:
    'These API terms are written for businesses and developers. jojo cannot tell you whether they fit a personal job search; checking that they fit your use is up to you.',
  liability: {
    party:
      'You are the account holder and the party to that agreement — jojo ships no key and makes no request of its own.',
    breach: 'Compliance with {{short}}’s terms is yours, and jojo accepts no liability for any breach of them.',
  },
} as const

/** `CLOUD_TERMS_EN` read the way i18next would read it, for callers outside an app. */
export const englishCloudT: Translate = englishTranslator('cloudNotice', CLOUD_TERMS_EN)

const plain = (text: string): Segment => ({ text })
const strong = (text: string): Segment => ({ text, emphasis: true })

/**
 * Sentences in one paragraph, a space apart. The space is not translated: the
 * scripts in the set that write without one between sentences (Chinese,
 * Japanese) read a single space there as a slightly wide gap, not as an error,
 * and a key for it would be a key every translator could get wrong.
 */
const sentences = (...parts: readonly Segment[]): Segment[] =>
  parts.flatMap((part, i) => (i === 0 ? [part] : [plain(' '), part]))

/**
 * The notice for one provider.
 *
 * `name` is the provider's full label and `short` the same without the
 * parenthesised name — "Anthropic (Claude)" reads correctly in a headline and badly
 * in a possessive, which is the distinction both apps were
 * already making and is kept here so they cannot disagree about it either.
 *
 * `t` is the app's translator, bound so that `headline` means this notice's
 * headline (see the header); left out, the notice is in English.
 */
export function cloudTerms(provider: ProviderMeta, t: Translate = englishCloudT): CloudTerms {
  const name = provider.label.split(' —')[0] ?? provider.label
  const short = name.replace(/\s*\([^)]*\)\s*$/, '')
  const say = (key: string) => t(key, { name, short })

  const paragraphs: Segment[][] = [
    sentences(plain(say('sent.what')), strong(say('sent.others')), plain(say('sent.local'))),
    sentences(plain(say('background'))),
    sentences(
      plain(say(provider.freeTier ? 'cost.freeTier' : 'cost.paid')),
      plain(say('cost.bargain')),
    ),
    ...(provider.id === 'openrouter' ? [sentences(plain(say('openrouter')))] : []),
    sentences(plain(say('business'))),
  ]

  return {
    headline: say('headline'),
    paragraphs,
    liability: sentences(
      plain(say('liability.party')),
      // Emphasised because it is the sentence that says whose problem a breach
      // is, and it is the one somebody skimming a warning box will skip.
      strong(say('liability.breach')),
    ),
  }
}
