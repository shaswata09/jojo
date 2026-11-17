/**
 * The Statistics page's advice — the ranked next steps (`recommend.ts`) and
 * the search-health radar (`searchHealthFor`) — in whatever language the app
 * is showing.
 *
 * The same seam as `domain-text.ts`, for the same reasons: the builders write
 * their English beside the arithmetic, the agent and the tests read that
 * English, and the apps show the sentences in ten languages. So each builder
 * also returns the FACTS its sentences are made of (`Recommendation.facts`,
 * `HealthAxis.id`/`facts`), and this file says them again through a
 * translator. Core may not import i18next; each app binds
 * `adviceText(i18next.t)`.
 *
 * `ADVICE_EN` is the `advice` namespace in English. Each app's
 * `locales/en/advice.json` equals it (`catalogs.test.ts`), and
 * `advice-text.test.ts` holds every sentence it renders to the English field
 * the builder wrote, word for word — so the two Englishes cannot drift.
 *
 * Every variant is a whole sentence, and counts are i18next plurals (`_one`,
 * `_other`, and whatever else a language needs). The one place a rendered
 * piece goes into a frame is a day count ("5 days"), a counted noun phrase
 * every language here can place.
 */

import { DOMAIN_EN, englishTranslator } from './domain-text'
import type { Translate } from './domain-text'
import type { ArmFacts, Recommendation } from './recommend'
import type { HealthAxis, HealthAxisId } from './statistics'

/** The four sentences a finding can be, by what was split and what was measured. */
const SEGMENT_BECAUSE = (measured: string, split: string) =>
  `{{count}} of {{of}} ${measured} there ({{rate}}%, likely {{low}}–{{high}}%), against {{worstCount}} of {{worstOf}} for {{worst}} ({{worstRate}}%, likely {{worstLow}}–{{worstHigh}}%). Split by ${split}.`

/** `{ key_one, key_other }`, the same sentence twice — English's count does not change it. */
const plural = <K extends string>(key: K, text: string) =>
  ({ [`${key}_one`]: text, [`${key}_other`]: text }) as Record<`${K}_one` | `${K}_other`, string>

/** The `advice` namespace, in English. Each app's `en/advice.json` equals this. */
export const ADVICE_EN = {
  /** 'Replies to you arrive in 5 days typically' — the one counted phrase set into a sentence. */
  days_one: '{{count}} day',
  days_other: '{{count}} days',
  rec: {
    segment: {
      /**
       * How an arm's name (a source or role tag the person chose) is written
       * inside a sentence: `lower` ("into referral") or `asWritten`. English
       * lowercases; a German noun or a name like "LinkedIn" must not be.
       */
      labelCase: 'lower',
      headline: 'Put more of your effort into {{label}}.',
      because: {
        source: {
          ...plural('replied', SEGMENT_BECAUSE('replied', 'where they came from')),
          ...plural('interview', SEGMENT_BECAUSE('reached an interview', 'where they came from')),
        },
        role: {
          ...plural('replied', SEGMENT_BECAUSE('replied', 'the kind of role')),
          ...plural('interview', SEGMENT_BECAUSE('reached an interview', 'the kind of role')),
        },
      },
    },
    late: {
      headline_one: 'Clear {{count}} overdue follow-up.',
      headline_other: 'Clear {{count}} overdue follow-ups.',
      because:
        'These are chases you already decided were worth making, on applications an employer has already seen. Nothing else on this list is as close to done.',
    },
    silent: {
      headline_one: 'Chase {{count}} application that has gone quiet.',
      headline_other: 'Chase {{count}} applications that have gone quiet.',
      because_one:
        'Replies to you arrive in {{days}} typically, and this one has passed that with nothing back. That is your own figure, not a rule of thumb.',
      because_other:
        'Replies to you arrive in {{days}} typically, and these have passed that with nothing back. That is your own figure, not a rule of thumb.',
    },
    stale: {
      headline_one: 'Record what happened on {{count}} application.',
      headline_other: 'Record what happened on {{count}} applications.',
      because_one:
        'It has had nothing written against it in a fortnight. Every rate on this page is only as good as what has been written down.',
      because_other:
        'They have had nothing written against them in a fortnight. Every rate on this page is only as good as what has been written down.',
    },
    drafts: {
      headlineSingle: 'Finish the draft or drop it.',
      /** Two or more; one draft is `headlineSingle`. */
      ...plural('headline', 'Finish the closest of {{count}} drafts, or drop them.'),
      because_one: 'A draft does nothing until it goes out. The oldest has been open {{count}} day.',
      because_other:
        'A draft does nothing until it goes out. The oldest has been open {{count}} days.',
    },
    background: {
      headline: 'Let jojo read your CV.',
      because:
        'Nothing about your own background is recorded, so no application can be weighed against what a posting asks for. It is one document and one confirmation.',
    },
    funnel: {
      replies: {
        headline: 'Rework the opening paragraph before you send the next one.',
        because:
          'Replies are where this search loses most against a typical one. {{got}} of {{of}} ({{rate}}%), against {{typical}}% for a typical search — a figure jojo chose as a round comparison, not one measured from anybody.',
      },
      interviews: {
        headline: 'Make the fit obvious in the first three lines.',
        because:
          'Replies that stall before a call are the biggest gap here — the interest is there and the case is not landing. {{got}} of {{of}} ({{rate}}%), against {{typical}}% for a typical search — a figure jojo chose as a round comparison, not one measured from anybody.',
      },
    },
    clear: {
      headline: 'Nothing here needs chasing.',
      because_one:
        'Every follow-up is on time, nothing has gone quiet, and there are no drafts waiting. {{count}} application is out.',
      because_other:
        'Every follow-up is on time, nothing has gone quiet, and there are no drafts waiting. {{count}} applications are out.',
    },
  },
  health: {
    axis: {
      sent: 'Sent',
      replies: 'Replies',
      interviews: 'Interviews',
      referrals: 'Referrals',
      followUps: 'Follow-ups',
      keptMoving: 'Kept moving',
    },
    basis: {
      ...plural('sent', '{{count}} of {{of}} out of draft'),
      ...plural('replies', '{{count}} of {{of}} replied'),
      ...plural('interviews', '{{count}} of {{of}} reached an interview'),
      ...plural('referrals', '{{count}} of {{of}} came through a referral'),
      followUpsNone: 'nothing open',
      ...plural('followUps', '{{count}} of {{of}} open follow-ups are late'),
      keptMovingNone: 'nothing live',
      ...plural('keptMoving', '{{count}} of {{of}} touched in the last fortnight'),
    },
    suggestion: {
      sent: {
        none: 'Nothing is sitting in draft. Worth protecting the care in each one rather than adding more.',
        some_one:
          '{{count}} application is still in draft. A draft does nothing until it goes out, and the one closest to done is the cheapest to finish.',
        some_other:
          '{{count}} applications are still in draft. A draft does nothing until it goes out, and the one closest to done is the cheapest to finish.',
      },
      replies: {
        nothingSent: 'Nothing has gone out yet, so there is nothing to measure a reply against.',
        none_one:
          'None of the {{count}} application sent has had a reply. That is the step to work on before sending more — tailoring the opening paragraph to each posting moves it more than anything else.',
        none_other:
          'None of the {{count}} applications sent has had a reply. That is the step to work on before sending more — tailoring the opening paragraph to each posting moves it more than anything else.',
        all: 'Every application sent has had a reply. Whatever the opening paragraph is doing, keep doing it.',
        ...plural(
          'some',
          '{{count}} of {{of}} came back. Tailoring the opening paragraph to each posting moves this more than anything else.',
        ),
      },
      interviews: {
        noReply: 'No reply has arrived yet, so nothing has had the chance to stall before a call.',
        none_one:
          '{{count}} reply has arrived and none has become a call. That gap is usually the fit not being obvious in the first paragraph.',
        none_other:
          '{{count}} replies have arrived and none has become a call. That gap is usually the fit not being obvious in the first paragraph.',
        some_one:
          '{{interviewed}} of the {{count}} reply became a call. Replies that stall before one usually mean the fit is not obvious early enough.',
        some_other:
          '{{interviewed}} of the {{count}} replies became a call. Replies that stall before one usually mean the fit is not obvious early enough.',
      },
      referrals: {
        none: 'None of these came through an introduction. A referred application is several times likelier to get a reply, so one is worth several cold sends.',
        ...plural(
          'some',
          '{{count}} of {{of}} came through an introduction. It is the highest-yield thing on this list, and the one that scales worst — which is why it is worth asking before the next cold send rather than after.',
        ),
      },
      followUps: {
        none: 'Nothing is late. A chase a week or so after sending is usually the one that lands.',
        late_one:
          '{{count}} follow-up is overdue. Clearing those usually pays off faster than applying somewhere new.',
        late_other:
          '{{count}} follow-ups are overdue. Clearing those usually pays off faster than applying somewhere new.',
      },
      keptMoving: {
        none: 'Nothing has gone quiet. Recording what happened as it happens is what keeps this honest.',
        stale_one:
          '{{count}} live application has had no activity in a fortnight. A short nudge costs less than starting somewhere new.',
        stale_other:
          '{{count}} live applications have had no activity in a fortnight. A short nudge costs less than starting somewhere new.',
      },
    },
  },
} as const

/** `ADVICE_EN` through `englishTranslator`: what the apps say, in English. */
export const englishAdviceT: Translate = englishTranslator('advice', ADVICE_EN)

/** `Comparison.dimension`/`.measure` (English, from `segments.ts`) back to catalog keys. */
const DIMENSION_ID: ReadonlyMap<string, string> = new Map(
  Object.entries(DOMAIN_EN.dimension).map(([id, english]) => [english, id]),
)
const MEASURE_ID: ReadonlyMap<string, string> = new Map([
  ['replied', 'replied'],
  ['reached an interview', 'interview'],
])

/** Every advice sentence, speaking through `t`. Bind once per app: `adviceText(i18next.t)`. */
export function adviceText(t: Translate) {
  const a = (key: string, options?: Record<string, unknown>) => t(`advice:${key}`, options)

  /** An arm's name inside a sentence, cased the way the language writes it there. */
  const armName = (arm: ArmFacts) =>
    a('rec.segment.labelCase') === 'lower' ? arm.label.toLowerCase() : arm.label

  return {
    /** A `Recommendation`'s `headline` and `because`, in the language on screen. */
    recommendation: (
      r: Pick<Recommendation, 'facts' | 'headline' | 'because'>,
    ): { headline: string; because: string } => {
      const f = r.facts
      switch (f.kind) {
        case 'segment': {
          const dimension = DIMENSION_ID.get(f.dimension)
          const measure = MEASURE_ID.get(f.measure)
          // A split this file has no sentence for is shown as core wrote it.
          if (dimension === undefined || measure === undefined)
            return { headline: r.headline, because: r.because }
          return {
            headline: a('rec.segment.headline', { label: armName(f.best) }),
            because: a(`rec.segment.because.${dimension}.${measure}`, {
              count: f.best.count,
              of: f.best.of,
              rate: f.best.rate,
              low: f.best.low,
              high: f.best.high,
              worst: armName(f.worst),
              worstCount: f.worst.count,
              worstOf: f.worst.of,
              worstRate: f.worst.rate,
              worstLow: f.worst.low,
              worstHigh: f.worst.high,
            }),
          }
        }
        case 'late':
          return {
            headline: a('rec.late.headline', { count: f.count }),
            because: a('rec.late.because'),
          }
        case 'silent':
          return {
            headline: a('rec.silent.headline', { count: f.count }),
            because: a('rec.silent.because', {
              count: f.count,
              days: a('days', { count: f.median }),
            }),
          }
        case 'stale':
          return {
            headline: a('rec.stale.headline', { count: f.count }),
            because: a('rec.stale.because', { count: f.count }),
          }
        case 'drafts':
          return {
            headline:
              f.count === 1
                ? a('rec.drafts.headlineSingle')
                : a('rec.drafts.headline', { count: f.count }),
            because: a('rec.drafts.because', { count: f.oldestDays }),
          }
        case 'background':
          return { headline: a('rec.background.headline'), because: a('rec.background.because') }
        case 'funnel':
          return {
            headline: a(`rec.funnel.${f.step}.headline`),
            because: a(`rec.funnel.${f.step}.because`, {
              got: f.got,
              of: f.of,
              rate: f.rate,
              typical: f.typical,
            }),
          }
        case 'clear':
          return {
            headline: a('rec.clear.headline'),
            because: a('rec.clear.because', { count: f.sent }),
          }
      }
    },

    /** A radar axis's name — `HealthAxis.axis` in any language. */
    axis: (id: HealthAxisId) => a(`health.axis.${id}`),

    /** A `HealthAxis`'s `axis`, `basis` and `suggestion`, in the language on screen. */
    health: (h: Pick<HealthAxis, 'id' | 'facts'>) => {
      const f = h.facts
      const axis = a(`health.axis.${h.id}`)
      const s = (key: string, options?: Record<string, unknown>) =>
        a(`health.suggestion.${h.id}.${key}`, options)
      switch (h.id) {
        case 'sent':
          return {
            axis,
            basis: a('health.basis.sent', { count: f.sent, of: f.total }),
            suggestion: f.drafts === 0 ? s('none') : s('some', { count: f.drafts }),
          }
        case 'replies':
          return {
            axis,
            basis: a('health.basis.replies', { count: f.replied, of: f.sent }),
            suggestion:
              f.sent === 0
                ? s('nothingSent')
                : f.replied === 0
                  ? s('none', { count: f.sent })
                  : f.replied === f.sent
                    ? s('all')
                    : s('some', { count: f.replied, of: f.sent }),
          }
        case 'interviews':
          return {
            axis,
            basis: a('health.basis.interviews', { count: f.interviewed, of: f.sent }),
            suggestion:
              f.replied === 0
                ? s('noReply')
                : f.interviewed === 0
                  ? s('none', { count: f.replied })
                  : s('some', { count: f.replied, interviewed: f.interviewed }),
          }
        case 'referrals':
          return {
            axis,
            basis: a('health.basis.referrals', { count: f.referred, of: f.total }),
            suggestion:
              f.referred === 0 ? s('none') : s('some', { count: f.referred, of: f.total }),
          }
        case 'followUps':
          return {
            axis,
            basis:
              f.open === 0
                ? a('health.basis.followUpsNone')
                : a('health.basis.followUps', { count: f.late, of: f.open }),
            suggestion: f.late === 0 ? s('none') : s('late', { count: f.late }),
          }
        case 'keptMoving':
          return {
            axis,
            basis:
              f.live === 0
                ? a('health.basis.keptMovingNone')
                : a('health.basis.keptMoving', { count: f.live - f.stale, of: f.live }),
            suggestion: f.stale === 0 ? s('none') : s('stale', { count: f.stale }),
          }
      }
    },
  }
}

export type AdviceText = ReturnType<typeof adviceText>
