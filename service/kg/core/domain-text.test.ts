/**
 * The `domain` namespace says, in English, exactly what core's English
 * functions say — so a translated app and the agent reading core describe the
 * same thing, and a sentence changed in one place fails here until the other
 * follows.
 *
 * This replaced a test each app held word for word (`handover-text.test.ts`),
 * which `check-no-copies` rightly refused: the logic is core's, so its test is.
 */

import { describe, expect, it } from 'vitest'
import { DOMAIN_EN, domainText, englishT } from './domain-text'
import { handoverSentence } from './handover'
import type { HandoverStatus } from './handover'
import { describeBackup, replacesClause } from './backup'
import type { RestorePlan } from './backup'
import { STAGE_LABEL } from './model'
import type { Instant, Stage } from './model'
import { OUTCOME_ACTION } from './transition-options'
import type { Outcome } from './model-application'
import { MONTH_LABELS } from './calendar'
import { EDGE_SCHEMA, RELS } from './model-graph'
import { PROVIDERS } from './provider'
import { KIND_LABEL } from './timeline-view'
import { FORMAT_LABEL, OUTCOME_LABEL } from './transition-options'
import { VERDICT_LABEL } from './tailor'
import { BACKGROUND_LABEL } from './model-profile'
import { TONE_LABEL } from './model-label'
import { MARK_LEGEND } from './marks'
import { DOCUMENT_LABEL } from './document-kind'
import { HOW_LABEL } from './posting-source'
import { CONTACT_ROLE_LABEL } from './model-person'
import { APPROVAL_LABEL } from './model-thread'
import { WEEKDAYS } from './calendar'
import { statsFor } from './statistics'
import { APPROVAL_MODES, APPROVAL_SAID } from './model-thread'
import { comparisonsFor } from './segments'
import type { Application, TimelineItem } from './model'
import { addDays, agoLabel, shortDate, whenLabel } from './dates'
import { bucketKeys, bucketLabel } from './frequency'
import { twinOfferCopy } from './twin'
import { duplicateMessage } from './duplicates'
import { CAPTURE_REJECTION_MESSAGE } from './capture'
import type { CaptureRejection } from './capture'
import { FILE_BUCKET_VALUES, LINK_CATEGORY_VALUES, SNIPPET_TAG_VALUES } from './model-vault'
import { SOURCES } from './model-application'

const en = domainText(englishT)
const at = '2026-11-16T09:00:00.000Z' as Instant

describe('the handover status, through the catalog', () => {
  const cases: HandoverStatus[] = [{ state: 'never' }]
  for (const days of [0, 1, 6]) {
    cases.push({ state: 'clean', at, days, writes: 0 })
    for (const writes of [1, 11]) cases.push({ state: 'drifted', at, days, writes })
  }

  it.each(cases.map((status) => [JSON.stringify(status), status] as const))(
    'says what handoverSentence says for %s',
    (_, status) => {
      expect(en.handover(status)).toBe(handoverSentence(status))
    },
  )
})

describe('the handover day count', () => {
  /*
   * The drifted sentence is counted by changes, so the days go in as their
   * own counted phrase — a language whose noun changes with the number of
   * days (Arabic: أيام for 3–10, يومًا for 11+) can only say it this way.
   */
  it('is counted by days, whatever the sentence around it is counted by', () => {
    const asked: [string, unknown][] = []
    const t = (key: string, options: Record<string, unknown> = {}) => {
      asked.push([key, options['count']])
      return key === 'domain:date.ago.days' ? `«${String(options['count'])}»` : `${key}|${String(options['ago'])}`
    }
    const status: HandoverStatus = { state: 'drifted', at, days: 5, writes: 11 }
    expect(domainText(t).handover(status)).toBe('domain:handover.drifted.daysAgo|«5»')
    expect(asked).toContainEqual(['domain:date.ago.days', 5])
    expect(asked).toContainEqual(['domain:handover.drifted.daysAgo', 11])
  })
})

describe('what a backup holds, through the catalog', () => {
  const node = (id: string, type = 'application') => ({ id, type }) as never
  const plan = (over: Partial<RestorePlan>): RestorePlan => ({
    exportedAt: '',
    nodes: [],
    edges: [],
    documents: [],
    loss: { records: 0, links: 0, changed: 0 },
    ...over,
  })
  const doc = (path: string) => ({ path, data: new Uint8Array(1) })

  const plans: [string, RestorePlan][] = [
    ['empty', plan({})],
    ['one of each', plan({ nodes: [node('a')], edges: [{} as never], documents: [doc('Documents/x')] })],
    ['several', plan({ nodes: [node('a'), node('b')], edges: [{} as never, {} as never] })],
    ['records unread', plan({ nodes: [node('a')], loss: { records: 2, links: 0, changed: 0 } })],
    ['links unread', plan({ loss: { records: 0, links: 1, changed: 0 } })],
    ['both unread', plan({ loss: { records: 1, links: 3, changed: 0 } })],
    ['one changed', plan({ loss: { records: 0, links: 0, changed: 1 } })],
    ['unread and changed', plan({ loss: { records: 1, links: 1, changed: 4 } })],
  ]

  it.each(plans)('says what describeBackup says: %s', (_, p) => {
    expect(en.backup(p)).toBe(describeBackup(p))
  })

  const file = (id: string) => node(id, 'file')
  const kept = (n: number) => plan({ nodes: Array.from({ length: n }, (_, i) => file(`file:${i}`)) })
  const whole = plan({ nodes: [file('file:a')], documents: [doc('Documents/file:a__CV.pdf')] })

  it.each([
    ['computer', 'you have now'],
    ['phone', 'on this phone'],
  ] as const)('says what replacesClause says, on the %s', (where, here) => {
    for (const p of [whole, kept(1), kept(3)]) {
      expect(en.replaces(p, where)).toBe(replacesClause(p, here))
    }
  })
})

describe('relative days and short dates, through the catalog', () => {
  const today = '2026-11-16'
  const offsets = [-400, -30, -14, -13, -8, -3, -2, -1, 0, 1, 2, 3, 8, 13, 14, 30, 400]
  const item = (date: string, completedOn?: string): TimelineItem =>
    ({
      id: 'item:x',
      title: 'x',
      date,
      allDay: true,
      kind: 'deadline',
      urgency: 'gray',
      applicationIds: [],
      remind: false,
      ...(completedOn === undefined ? {} : { completedOn }),
    }) as TimelineItem

  it('writes every short date as shortDate does', () => {
    for (const month of [1, 5, 9, 12]) {
      const iso = `2026-${String(month).padStart(2, '0')}-07`
      expect(en.shortDate(iso)).toBe(shortDate(iso))
    }
    expect(en.shortDate('2026-11-11T09:30:00.000Z')).toBe(shortDate('2026-11-11T09:30:00.000Z'))
  })

  it('says what agoLabel says, either side of the two-week cut-off and in the future', () => {
    for (const n of offsets) {
      const iso = addDays(today, n)
      expect(en.ago(iso, today)).toBe(agoLabel(iso, today))
    }
  })

  it('says what whenLabel says, due and completed', () => {
    for (const n of offsets) {
      const iso = addDays(today, n)
      expect(en.when(item(iso), today)).toBe(whenLabel(item(iso), today))
      expect(en.relative(today, iso)).toBe(whenLabel(item(iso), today))
      expect(en.when(item(today, iso), today)).toBe(whenLabel(item(today, iso), today))
    }
  })

  it('labels every frequency bucket as bucketLabel does', () => {
    for (const period of ['week', 'month', 'quarter'] as const) {
      for (const key of bucketKeys('2025-01-01', today, period)) {
        expect(en.bucketLabel(key, period)).toBe(bucketLabel(key, period))
      }
    }
  })

  it('lowercases only Today and Tomorrow when the phrase sits inside a sentence', () => {
    for (const n of [-3, -1, 0, 1, 5]) {
      const iso = addDays(today, n)
      expect(en.relative(today, iso, { inline: true })).toBe(whenLabel(item(iso), today).toLowerCase())
    }
  })

  it('writes the priority deck\'s timing as date, then reading', () => {
    expect(en.priority.timing('due', today, addDays(today, 4))).toBe('Due Nov 20 · in 4 days')
    expect(en.priority.timing('respondBy', today, today)).toBe('Respond by Nov 16 · Today')
    expect(en.priority.timing('wasDue', today, addDays(today, -1))).toBe('Was due Nov 15 · 1 day overdue')
    expect(en.priority.timing('on', today, addDays(today, 1))).toBe('Nov 17 · Tomorrow')
    expect(en.priority.headline('recordCall', 'Rice')).toBe('Record the Rice call')
  })
})

describe('labels and stored phrases', () => {
  it('names every relation the way the edge schema does', () => {
    for (const rel of RELS) expect(en.rel(rel)).toBe(EDGE_SCHEMA[rel].label)
  })

  it('names every model provider as the provider list does', () => {
    for (const p of PROVIDERS) expect(en.provider(p.id)).toBe(p.label)
  })

  it('writes short dates and month headings', () => {
    expect(en.dayMonth(11, 3)).toBe('Nov 3')
    expect(en.monthYear(11, 2026)).toBe('November 2026')
    expect(en.monthYearParts(11, 2026)).toEqual([
      { text: 'November ', isYear: false },
      { text: '2026', isYear: true },
    ])
    const yearFirst = domainText((key, o) =>
      key === 'domain:monthYear' ? `${String(o?.['year'])}年${String(o?.['month'])}` : '11月',
    )
    expect(yearFirst.monthYearParts(11, 2026)).toEqual([
      { text: '2026', isYear: true },
      { text: '年11月', isYear: false },
    ])
    expect(en.weekdayNarrow(0)).toBe('M')
    expect(en.monthShort(9)).toBe('Sep')
  })

  it('says every statistics tile, step and band as statsFor writes them', () => {
    const day = (n: number) => `2026-0${String(n)}-01` as never
    const apps = [
      { stage: 'submitted', submittedOn: day(1), firstReplyOn: day(2) },
      { stage: 'interview', submittedOn: day(1), firstReplyOn: day(3) },
      { stage: 'offer', submittedOn: day(2), firstReplyOn: day(3) },
      { stage: 'closed', outcome: 'rejected', submittedOn: day(1) },
      { stage: 'draft' },
    ].map((over, i) => ({ id: `app:${String(i)}`, roleTag: 'Postdoc', ...over }) as unknown as Application)
    for (const all of [apps, apps.slice(0, 1), []]) {
      const stats = statsFor(all)
      for (const k of stats.kpis) {
        expect(en.kpi(k)).toEqual({ label: k.label, value: k.value, note: k.note, typical: k.typical })
      }
      for (const step of stats.funnel) expect(en.funnel(step.stage)).toBe(step.stage)
      for (const band of stats.outcomes) expect(en.band(band.label)).toBe(band.label)
      for (const c of comparisonsFor(all)) expect(en.dimension(c.dimension)).toBe(c.dimension)
    }
    for (const mode of APPROVAL_MODES) expect(en.approvalSaid(mode)).toBe(APPROVAL_SAID[mode])
  })

  it('says who read a fit and when, as useFit writes it', () => {
    expect(en.readBy('gemma_4_31b', '2026-11-13', '2026-11-16')).toBe('Read by gemma_4_31b · 3 days ago')
    expect(en.missingSource()).toBe('a document no longer in the Vault')
  })

  it('names every value of every core label table exactly as the table does', () => {
    const tables: [Record<string, string>, (key: never) => string][] = [
      [STAGE_LABEL, en.stage],
      [KIND_LABEL, en.kind],
      [OUTCOME_LABEL, en.outcome],
      [FORMAT_LABEL, en.format],
      [VERDICT_LABEL, en.verdict],
      [BACKGROUND_LABEL, en.background],
      [TONE_LABEL, en.tone],
      [MARK_LEGEND, en.mark],
      [DOCUMENT_LABEL, en.document],
      [HOW_LABEL, en.how],
      [CONTACT_ROLE_LABEL, en.contactRole],
      [APPROVAL_LABEL, en.approval],
    ]
    for (const [table, say] of tables) {
      for (const [key, english] of Object.entries(table)) expect(say(key as never)).toBe(english)
    }
    WEEKDAYS.forEach((day, i) => expect(en.weekdayShort(i)).toBe(day))
    expect(en.weekday(0)).toBe('Sunday')
    expect(en.dimension('something new')).toBe('something new')
  })

  it('says every stored link category, snippet tag, source and file drawer, and anything else as stored', () => {
    const lists: [readonly string[], (value: string) => string][] = [
      [LINK_CATEGORY_VALUES, en.linkCategory],
      [SNIPPET_TAG_VALUES, en.snippetTag],
      [SOURCES, en.source],
      [FILE_BUCKET_VALUES, en.fileBucket],
    ]
    for (const [values, say] of lists) {
      for (const value of values) expect(say(value)).toBe(value)
      expect(say('Something a person typed')).toBe('Something a person typed')
    }
    // Through a translator: the stored value finds its key, and the key is what is said.
    const keyed = domainText((key) => `<${key}>`)
    expect(keyed.snippetTag('Cover letter')).toBe('<domain:snippetTag.coverLetter>')
    expect(keyed.source('Careers page')).toBe('<domain:source.careersPage>')
    expect(keyed.fileBucket('To read')).toBe('<domain:fileBucket.toRead>')
    expect(keyed.linkCategory('Guide')).toBe('<domain:linkCategory.guide>')
    expect(keyed.linkCategory('guide')).toBe('guide')
    // A comparison's arm is a source only when the comparison is by source.
    expect(keyed.armLabel(DOMAIN_EN.dimension.source, 'Referral')).toBe('<domain:source.referral>')
    expect(keyed.armLabel(DOMAIN_EN.dimension.role, 'Referral')).toBe('Referral')
  })

  it('says the priority deck’s fixed words from the catalog', () => {
    const p = DOMAIN_EN.priority
    for (const k of Object.keys(p.kind) as (keyof typeof p.kind)[]) expect(en.priority.kind(k)).toBe(p.kind[k])
    for (const b of Object.keys(p.button) as (keyof typeof p.button)[])
      expect(en.priority.button(b)).toBe(p.button[b])
    expect(en.priority.noDate()).toBe(p.timing.none)
    expect(en.priority.undatedInterview()).toBe(p.undatedInterview)
    expect(en.priority.unfiled()).toBe(p.unfiled)
    expect(en.priority.unknownOrg()).toBe(p.unknownOrg)
  })

  it('names the month beside a day the way English does', () => {
    for (let m = 1; m <= 12; m++) expect(en.monthOfDay(m)).toBe(en.month(m))
  })

  it('names months 1-based, as CalendarDay does', () => {
    expect(en.month(1)).toBe(MONTH_LABELS[0])
    expect(en.month(12)).toBe(MONTH_LABELS[11])
  })

  it('reads every phrase the app stores as a lastAction back to its key', () => {
    const t = (key: string) => `‹${key}›`
    const marked = domainText(t)
    const stored = [
      ...(Object.keys(STAGE_LABEL) as Stage[]).flatMap((s) => [
        `Moved to ${STAGE_LABEL[s]}`,
        `Added at ${STAGE_LABEL[s]}`,
      ]),
      ...['Phone', 'Video', 'Onsite'].map((f) => `${f} interview scheduled`),
      ...(Object.keys(OUTCOME_ACTION) as Outcome[]).map((o) => OUTCOME_ACTION[o]),
      'Details edited',
      'Draft created',
      'Offer received',
      'Duplicated',
      'Added from Job scout',
      'Added from a saved posting',
      'Note edited',
      'Offer details cleared',
      'Flagged for follow-up',
      'Flag cleared',
    ]
    for (const phrase of stored) {
      expect(marked.action(phrase)).toMatch(/^‹domain:/)
      expect(en.action(phrase)).toBe(phrase)
    }
  })

  it('shows anything else stored as a lastAction exactly as it was written', () => {
    expect(en.action('Emailed the chair about the visit')).toBe('Emailed the chair about the visit')
  })

  it('files under names, two names, many, or nothing', () => {
    expect(en.filedUnder([])).toBe('unfiled')
    expect(en.filedUnder(['Rice'])).toBe('filed under Rice')
    expect(en.filedUnder(['Rice', 'Baylor'])).toBe('filed under Rice and Baylor')
    expect(en.filedUnder(['a', 'b', 'c'])).toBe('filed under 3 applications')
  })

  it('has no empty string anywhere in the English catalog', () => {
    const walk = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : Object.values(v as object).flatMap(walk)
    for (const s of walk(DOMAIN_EN)) expect(s.trim()).not.toBe('')
  })
})

/*
 * Review 2026-11-17: three sentences core wrote in English went into
 * translated screens as they were — the profile-read consent banner, the
 * duplicate warning at Save, and why a captured page was refused. Each now has
 * a `domain` key, and says in English exactly what the core function says.
 */
describe('sentences the apps used to show in English', () => {
  const gap = (subject: string) => ({ kind: 'unread-document' as const, subject, id: subject, instruction: '' })

  it('asks to read a document exactly as twinOfferCopy does', () => {
    for (const gaps of [[], [gap('CV.pdf')], [gap('CV.pdf'), gap('bio.pdf')], [gap('a'), gap('b'), gap('c')]]) {
      expect(en.twinOffer(gaps)).toEqual(twinOfferCopy(gaps))
    }
  })

  it('names a duplicate exactly as duplicateMessage does', () => {
    for (const reason of ['id', 'url', 'name'] as const) {
      expect(en.duplicate(reason, 'Rice — Statistics')).toBe(duplicateMessage(reason, 'Rice — Statistics'))
    }
  })

  it('says why a capture was refused exactly as the core table does', () => {
    for (const [reason, message] of Object.entries(CAPTURE_REJECTION_MESSAGE)) {
      expect(en.captureRejected(reason as CaptureRejection)).toBe(message)
    }
  })

  it('labels a picker with one name, two, or a count', () => {
    expect(en.picked([])).toBe('')
    expect(en.picked(['Rice'])).toBe('Rice')
    expect(en.picked(['Rice', 'Baylor'])).toBe('Rice and Baylor')
    expect(en.picked(['a', 'b', 'c'])).toBe('3 applications')
  })
})
