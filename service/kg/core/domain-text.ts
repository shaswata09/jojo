/**
 * The model's own words — stage names, timeline kinds, months, the backup and
 * handover sentences — in whatever language the app is showing.
 *
 * ## Why this lives in core
 *
 * The English is core's: `STAGE_LABEL`, `KIND_LABEL`, `describeBackup` and the
 * rest are written here, beside the unions they name, and the agent, the tools
 * and the tests read them in English. The two apps show the same words in ten
 * languages. Before this file each app either rendered the English table
 * inside a translated screen ("Interview" in a Japanese board) or copied the
 * sentence logic into a helper of its own — which is how the handover text came
 * to exist twice, word for word.
 *
 * So core holds the logic once and takes the translator as a parameter. Core
 * may not import i18next (no third-party packages below L2); it does not need
 * to. Each app binds `domainText(i18next.t)` and gets every helper below.
 *
 * ## The English catalog is generated, not written
 *
 * `DOMAIN_EN` is the `domain` namespace's English, built FROM the tables. Each
 * app's `locales/en/domain.json` must equal it (`catalogs.test.ts` on each
 * platform), so a label changed here without the catalog fails a test instead
 * of shipping two Englishes. `englishT` renders it the way i18next would, and
 * `domain-text.test.ts` holds every sentence it renders to the English
 * function it stands in for — `handoverSentence`, `describeBackup`,
 * `replacesClause` — word for word.
 *
 * ## Whole sentences, not fragments
 *
 * Where a sentence varies (a stage inside "Moved to …", a format inside
 * "… interview scheduled", the device inside "Restoring replaces …"), each
 * variant is its own key, so a language can inflect or reorder it. The only
 * frames that take a translated piece are counted noun phrases ("3 records")
 * inside a list, which every language in the set can write as a list.
 */

import { STAGE_LABEL } from './model'
import type { Period, ProfileDocument, Stage, TimelineItem, TimelineKind } from './model'
import type { Outcome } from './model-application'
import { KIND_LABEL } from './timeline-view'
import { FORMAT_LABEL, OUTCOME_ACTION, OUTCOME_LABEL } from './transition-options'
import type { Format } from './transition-options'
import { VERDICT_LABEL } from './tailor'
import type { Verdict } from './tailor'
import { BACKGROUND_LABEL } from './model-profile'
import type { BackgroundKind } from './model-profile'
import { TONE_LABEL } from './model-label'
import type { LabelTone } from './model-label'
import { MARK_LEGEND } from './marks'
import { DOCUMENT_LABEL } from './document-kind'
import { HOW_LABEL } from './posting-source'
import type { PostingSource } from './posting-source'
import { CONTACT_ROLE_LABEL } from './model-person'
import type { ContactRole } from './model-person'
import { APPROVAL_LABEL, APPROVAL_SAID } from './model-thread'
import type { ApprovalMode } from './model-thread'
import { EDGE_SCHEMA, RELS } from './model-graph'
import type { Rel } from './model-graph'
import { MONTH_LABELS, WEEKDAYS } from './calendar'
import { PROVIDERS } from './provider'
import type { ProviderId } from './provider'
import type { HandoverStatus } from './handover'
import { FUNNEL_STEPS, OUTCOME_BANDS } from './statistics'
import type { Kpi } from './statistics'
import { keptDocuments } from './backup'
import type { RestorePlan } from './backup'
import { lossOf, validateRows } from './validate'
import { daysBetween, partsOf } from './dates'
import type { TwinGap } from './twin'
import type { DuplicateOf } from './duplicates'
import { CAPTURE_REJECTION_MESSAGE } from './capture'
import type { CaptureRejection } from './capture'

/** The shape of `i18next.t` this file uses: a key, and values to put in it. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

/** Where a restore lands, for the sentence that says what it replaces. */
export type RestoreWhere = 'computer' | 'phone'

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const indexed = (list: readonly string[], from: number): Record<string, string> =>
  Object.fromEntries(list.map((value, i) => [String(i + from), value]))

const each = <K extends string>(
  keys: readonly K[],
  write: (key: K) => string,
): Record<K, string> => Object.fromEntries(keys.map((k) => [k, write(k)])) as Record<K, string>

const FORMATS = Object.keys(FORMAT_LABEL) as Format[]
const STAGES = Object.keys(STAGE_LABEL) as Stage[]

/**
 * The words a stored `lastAction` is written in, by the code that writes it
 * (`stage-policy.ts`, `tools/application-*.ts`, `tools/scout.ts`, the apps'
 * stage moves and flag toggles). Stored in English because it is data the
 * agent reads; shown in the viewer's language by `action()` below, which reads
 * it back. Exported so a writer spells the phrase from here: a literal that
 * drifts from this table is a phrase every other language shows in English.
 */
export const ACTION_PHRASES = {
  detailsEdited: 'Details edited',
  draftCreated: 'Draft created',
  offerReceived: 'Offer received',
  duplicated: 'Duplicated',
  addedFromScout: 'Added from Job scout',
  addedFromPosting: 'Added from a saved posting',
  noteEdited: 'Note edited',
  offerCleared: 'Offer details cleared',
  flagged: 'Flagged for follow-up',
  flagCleared: 'Flag cleared',
} as const

/** The `domain` namespace, in English. Each app's `en/domain.json` equals this. */
export const DOMAIN_EN = {
  stage: { ...STAGE_LABEL },
  kind: { ...KIND_LABEL },
  outcome: { ...OUTCOME_LABEL },
  outcomeAction: { ...OUTCOME_ACTION },
  format: { ...FORMAT_LABEL },
  verdict: { ...VERDICT_LABEL },
  background: { ...BACKGROUND_LABEL },
  tone: { ...TONE_LABEL },
  mark: { ...MARK_LEGEND },
  document: { ...DOCUMENT_LABEL },
  how: { ...HOW_LABEL },
  contactRole: { ...CONTACT_ROLE_LABEL },
  approval: { ...APPROVAL_LABEL },
  approvalSaid: { ...APPROVAL_SAID },
  /** The statistics funnel's steps and the outcome bands, by position. */
  funnel: indexed(FUNNEL_STEPS, 0),
  band: indexed(OUTCOME_BANDS, 0),
  /** The split a comparison is over (`segments.ts` writes the English). */
  dimension: { source: 'where they came from', role: 'the kind of role' },
  kpi: {
    label: {
      response: 'Response rate',
      interview: 'Interview rate',
      offer: 'Offer rate',
      reply: 'Median reply time',
    },
    note: {
      response_one: '{{count}} of {{of}} replied',
      response_other: '{{count}} of {{of}} replied',
      interview_one: '{{count}} of {{of}} reached an interview',
      interview_other: '{{count}} of {{of}} reached an interview',
      offer_one: '{{count}} of {{of}} reached an offer',
      offer_other: '{{count}} of {{of}} reached an offer',
      replyNone: 'no reply yet with both dates recorded',
      reply_one: 'across {{count}} reply',
      reply_other: 'across {{count}} replies',
    },
    days_one: '{{count}} day',
    days_other: '{{count}} days',
    typicalRate: '{{value}}% typical',
    /** `{{days}}` is `kpi.days` ('14 days'), counted so a language can inflect it. */
    typicalDays: '{{days}} typical',
  },
  rel: each(RELS, (rel) => EDGE_SCHEMA[rel].label),
  /** Mostly product names, kept as they are; two carry words ("A local server", "free"). */
  provider: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label])) as Record<ProviderId, string>,
  month: indexed(MONTH_LABELS, 1),
  /**
   * The month as it reads beside a day number — the same word as `month` in
   * English, but Russian says «5 ноября», not «5 ноябрь». Filled from CLDR's
   * format context for every language.
   */
  monthOfDay: indexed(MONTH_LABELS, 1),
  /** Abbreviated, for a tight column. Other languages take CLDR's own short forms, not a slice. */
  monthShort: indexed(MONTH_LABELS.map((m) => m.slice(0, 3)), 1),
  weekdayShort: indexed(WEEKDAYS, 0),
  weekday: indexed(WEEKDAY_LONG, 0),
  /** 'Nov 3': a short month and a day, in the order the language writes them. */
  dayMonth: '{{month}} {{day}}',
  /** 'November 2026'; '2026年11月' where the year comes first. */
  monthYear: '{{month}} {{year}}',
  /** A quarter on the frequency chart's axis: 'Q3 2026' (`frequency.ts` `bucketLabel`). */
  quarter: 'Q{{quarter}} {{year}}',
  /** One-glyph column heads, Mon-first. A first letter is ambiguous in Arabic and Hindi; CLDR's narrow forms are not. */
  weekdayNarrow: indexed(WEEKDAYS.map((w) => w.slice(0, 1)), 0),
  action: {
    ...ACTION_PHRASES,
    movedTo: each(STAGES, (s) => `Moved to ${STAGE_LABEL[s]}`),
    addedAt: each(STAGES, (s) => `Added at ${STAGE_LABEL[s]}`),
    interviewScheduled: each(FORMATS, (f) => `${FORMAT_LABEL[f]} interview scheduled`),
  },
  /**
   * The relative-day vocabulary of `dates.ts` — `agoLabel`, `whenLabel` — as
   * whole phrases. `ago` leads lowercase because every place it goes is the
   * middle of a sentence ("saved 3 days ago"); `inline` is the two capitalised
   * `when` words for the same position. A count past the one English never
   * reaches ("in 1 day" is "Tomorrow") is still written, for a language whose
   * plural forms are not English's.
   */
  date: {
    ago: {
      today: 'today',
      yesterday: 'yesterday',
      days_one: '{{count}} day ago',
      days_other: '{{count}} days ago',
    },
    when: {
      today: 'Today',
      tomorrow: 'Tomorrow',
      inDays_one: 'in {{count}} day',
      inDays_other: 'in {{count}} days',
      overdue_one: '{{count}} day overdue',
      overdue_other: '{{count}} days overdue',
    },
    inline: { today: 'today', tomorrow: 'tomorrow' },
    completed: {
      today: 'Completed today',
      yesterday: 'Completed yesterday',
      days_one: 'Completed {{count}} day ago',
      days_other: 'Completed {{count}} days ago',
      on: 'Completed {{date}}',
    },
  },
  /** The dashboard's priority deck (`react/use-priority.ts`): chips, headlines, timing, buttons. */
  priority: {
    kind: { offer: 'Offer', overdue: 'Overdue', deadline: 'Deadline', interview: 'Interview' },
    headline: {
      reply: 'Reply to {{org}}',
      submitOrLetGo: 'Submit to {{org}} or let it go',
      recordInterview: 'Record the {{org}} interview',
      recordVisit: 'Record the {{org}} visit',
      recordCall: 'Record the {{org}} call',
      catchUp: 'Catch up on {{org}}',
      submit: 'Submit to {{org}}',
      prepare: 'Prepare for {{org}}',
      dateInterview: 'Date the {{org}} interview',
    },
    timing: {
      respondBy: 'Respond by {{date}} · {{when}}',
      wasDue: 'Was due {{date}} · {{when}}',
      due: 'Due {{date}} · {{when}}',
      on: '{{date}} · {{when}}',
      none: 'No date set',
    },
    button: {
      draftReply: 'Draft a reply',
      recordOutcome: 'Record what happened',
      acceptOrDecline: 'Accept or decline',
      openApplication: 'Open application',
      draftMessage: 'Draft a message',
    },
    undatedInterview:
      'At interview stage with nothing dated against it, so neither the week ahead nor the calendar can show it.',
    unfiled: 'This deadline is not filed under an application',
    unknownOrg: 'Unknown',
  },
  filed: {
    none: 'unfiled',
    one: 'filed under {{a}}',
    two: 'filed under {{a}} and {{b}}',
    many_one: 'filed under {{count}} application',
    many_other: 'filed under {{count}} applications',
  },
  /**
   * An application picker's label (`applicationsLabel` in `data/seed.ts`): one
   * name as it is, two joined, more counted.
   */
  picked: {
    two: '{{a}} and {{b}}',
    many_one: '{{count}} application',
    many_other: '{{count}} applications',
  },
  /**
   * The offer to read a document into the profile (`twinOfferCopy` in
   * `twin.ts`). The wording is the consent, so it says what happens: a model
   * reads the document and records what it states, and each entry is shown
   * first.
   */
  twinOffer: {
    unnamed: 'that document',
    title: 'Read {{first}} into your profile?',
    titleMore_one: 'Read {{first}} and {{count}} more into your profile?',
    titleMore_other: 'Read {{first}} and {{count}} more into your profile?',
    body: 'jojo will read what is inside and record the facts it states — your degrees, posts, publications and skills — so it can weigh a job posting against what you have actually done. Every entry it adds is shown to you first, and says which document it came from.',
  },
  /** Why Save stopped on a posting already tracked (`duplicateMessage` in `duplicates.ts`). */
  duplicate: {
    id: "This posting's ID is already on {{name}}.",
    url: 'You already saved this posting as {{name}}.',
    name: 'You already have {{name}}.',
  },
  /** Why a captured page was not kept (`CAPTURE_REJECTION_MESSAGE` in `capture.ts`). */
  captureRejected: { ...CAPTURE_REJECTION_MESSAGE },
  /** Under a fit reading: who read it, and when. */
  readBy: 'Read by {{model}} · {{ago}}',
  /** A tailored snippet whose source document has since left the Vault. */
  missingSource: 'a document no longer in the Vault',
  /**
   * The ⌘Z / Ctrl+Z toast (`react/kg.tsx`) and the Undo on a shared tool's
   * toast (`react/use-tool.ts`). `nothing` and `changed` are the runtime's
   * two refusals (`tools/runtime.ts` `step`, `NothingToRevert`), read back by
   * their English. `journal` says whether the entry's label — stored English,
   * the title the tool's own toast had — is shown under Undone: `asWritten`
   * in English, `hidden` in a language it is not written in.
   */
  undo: {
    nothing: { undo: 'Nothing to undo.', redo: 'Nothing to redo.' },
    changed: {
      undo: 'Nothing to undo — it has changed since',
      redo: 'Nothing to redo — it has changed since',
    },
    done: { undo: 'Undone', redo: 'Redone' },
    journal: 'asWritten',
    action: 'Undo',
    /**
     * A card's Undo that declined to act (`react/undo.ts` `supersededToast`).
     * `named` lists the entries' labels, joined by `separator`; `unnamed` is
     * the same sentence for a language the stored labels are not written in.
     */
    superseded: {
      nothing: 'Nothing was undone',
      part: 'Part of that was left as it is',
      named:
        '{{labels}} — you have changed those records since, and undoing now would have taken those changes with it.',
      unnamed:
        'You have changed those records since, and undoing now would have taken those changes with it.',
      separator: ', ',
    },
  },
  /** A shared tool's toast (`react/use-tool.ts`) when the tool refused the write. */
  write: {
    refused: 'That did not save',
    didNotFit: 'Something about that record did not fit.',
  },
  /** Tool announcements the apps show through `useTool`, by the tool's English title. */
  announce: {
    stickyRemoved: 'Note removed',
  },
  handover: {
    never:
      'This device has never been in a transfer, so nothing has a copy of these records but this.',
    clean: {
      today:
        'Last transfer today, and nothing has been written here since — the other device is holding the same records.',
      yesterday:
        'Last transfer yesterday, and nothing has been written here since — the other device is holding the same records.',
      /** `{{ago}}` is `date.ago.days` ('5 days ago'), counted by days so a language can inflect it. */
      daysAgo:
        'Last transfer {{ago}}, and nothing has been written here since — the other device is holding the same records.',
    },
    drifted: {
      today_one:
        'Last transfer today, and one change has been made here since. The other device is that far behind.',
      today_other:
        'Last transfer today, and {{count}} changes have been made here since. The other device is that far behind.',
      yesterday_one:
        'Last transfer yesterday, and one change has been made here since. The other device is that far behind.',
      yesterday_other:
        'Last transfer yesterday, and {{count}} changes have been made here since. The other device is that far behind.',
      /** Counted by changes; `{{ago}}` carries the day count, as in `clean.daysAgo`. */
      daysAgo_one:
        'Last transfer {{ago}}, and one change has been made here since. The other device is that far behind.',
      daysAgo_other:
        'Last transfer {{ago}}, and {{count}} changes have been made here since. The other device is that far behind.',
    },
  },
  backup: {
    records_one: '{{count}} record',
    records_other: '{{count}} records',
    links_one: '{{count}} link',
    links_other: '{{count}} links',
    documents_zero: 'no documents',
    documents_one: '{{count}} document',
    documents_other: '{{count}} documents',
    summary: '{{records}}, {{links}}, {{documents}}',
    summaryLoss: '{{records}}, {{links}}, {{documents}} — of which {{loss}}',
    both: '{{a}} and {{b}}',
    leftOut: '{{what}} cannot be read and will be left out',
    changed_one: '{{count}} record will come back changed',
    changed_other: '{{count}} records will come back changed',
    leftOutAndChanged: '{{leftOut}}, and {{changed}}',
    replacesAll: {
      computer: 'Restoring replaces every record and every document you have now',
      phone: 'Restoring replaces every record and every document on this phone',
    },
    replacesKept: {
      computer_one:
        'Restoring replaces every record you have now and every document, except for the {{count}} record arriving without its document, whose copy already here is kept',
      computer_other:
        'Restoring replaces every record you have now and every document, except for the {{count}} records arriving without their documents, whose copies already here are kept',
      phone_one:
        'Restoring replaces every record on this phone and every document, except for the {{count}} record arriving without its document, whose copy already here is kept',
      phone_other:
        'Restoring replaces every record on this phone and every document, except for the {{count}} records arriving without their documents, whose copies already here are kept',
    },
  },
} as const

/** Reads a stored English `lastAction` back to the key that wrote it. */
const ACTION_KEYS: ReadonlyMap<string, string> = new Map([
  ...Object.entries(ACTION_PHRASES).map(([k, v]) => [v, `action.${k}`] as const),
  ...STAGES.flatMap((s) => [
    [DOMAIN_EN.action.movedTo[s], `action.movedTo.${s}`] as const,
    [DOMAIN_EN.action.addedAt[s], `action.addedAt.${s}`] as const,
  ]),
  ...FORMATS.map((f) => [DOMAIN_EN.action.interviewScheduled[f], `action.interviewScheduled.${f}`] as const),
  ...(Object.keys(OUTCOME_ACTION) as Outcome[]).map(
    (o) => [OUTCOME_ACTION[o], `outcomeAction.${o}`] as const,
  ),
])

/** Reads an English string a core builder put in a struct back to its key. */
const reverse = (table: Readonly<Record<string, string>>, prefix: string): ReadonlyMap<string, string> =>
  new Map(Object.entries(table).map(([k, v]) => [v, `${prefix}.${k}`]))
const ANNOUNCE_KEYS = reverse(DOMAIN_EN.announce, 'announce')
const FUNNEL_KEYS = reverse(DOMAIN_EN.funnel, 'funnel')
const BAND_KEYS = reverse(DOMAIN_EN.band, 'band')
const DIMENSION_KEYS = reverse(DOMAIN_EN.dimension, 'dimension')

/**
 * A catalog rendered the way i18next renders it: `{{name}}` filled in, and a
 * `count` choosing `_zero` (when written) then `_one` or `_other`. Only what
 * these namespaces use — enough for core and its tests to say in English what
 * the apps say through i18next, and no more. `ns` is the namespace prefix the
 * keys arrive with (`domain:stage.draft`).
 */
export function englishTranslator(ns: string, catalog: object): Translate {
  const lookup = (path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (at, part) =>
          at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined,
        catalog,
      )
  return (key, options = {}) => {
    const path = key.startsWith(`${ns}:`) ? key.slice(ns.length + 1) : key
    const count = options['count']
    const forms =
      typeof count === 'number'
        ? [...(count === 0 ? [`${path}_zero`] : []), `${path}_${count === 1 ? 'one' : 'other'}`, path]
        : [path]
    const found = forms.map(lookup).find((v) => typeof v === 'string')
    if (typeof found !== 'string') return key
    return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
  }
}

/** `DOMAIN_EN` through `englishTranslator`: what the apps say, in English. */
export const englishT: Translate = englishTranslator('domain', DOMAIN_EN)

/** Where the year goes in a rendered `monthYear` (a private-use character no catalog holds). */
const YEAR_MARK = '\uE000'

/** Every helper, speaking through `t`. Bind once per app: `domainText(i18next.t)`. */
export function domainText(t: Translate) {
  const d = (key: string, options?: Record<string, unknown>) => t(`domain:${key}`, options)
  const shortDate = (iso: string) => {
    const { m, d: day } = partsOf(iso)
    return d('dayMonth', { month: d(`monthShort.${String(m)}`), day })
  }
  const ago = (iso: string, today: string) => {
    const gap = daysBetween(iso, today)
    if (gap === 0) return d('date.ago.today')
    if (gap === 1) return d('date.ago.yesterday')
    if (gap > 1 && gap < 14) return d('date.ago.days', { count: gap })
    return shortDate(iso)
  }
  const relative = (today: string, iso: string, { inline = false }: { inline?: boolean }) => {
    const gap = daysBetween(today, iso)
    if (gap < 0) return d('date.when.overdue', { count: -gap })
    if (gap === 0) return d(inline ? 'date.inline.today' : 'date.when.today')
    if (gap === 1) return d(inline ? 'date.inline.tomorrow' : 'date.when.tomorrow')
    return d('date.when.inDays', { count: gap })
  }
  /**
   * The journal label under Undone, or undefined to leave it out: a label
   * this table knows is said in the language on screen, and any other is
   * stored English, shown only where English is the language.
   */
  const journal = (english: string): string | undefined => {
    const key = ANNOUNCE_KEYS.get(english)
    if (key !== undefined) return d(key)
    return d('undo.journal') === 'asWritten' ? english : undefined
  }

  return {
    stage: (s: Stage) => d(`stage.${s}`),
    kind: (k: TimelineKind) => d(`kind.${k}`),
    outcome: (o: Outcome) => d(`outcome.${o}`),
    format: (f: Format) => d(`format.${f}`),
    verdict: (v: Verdict) => d(`verdict.${v}`),
    background: (b: BackgroundKind) => d(`background.${b}`),
    tone: (tone: LabelTone) => d(`tone.${tone}`),
    mark: (m: keyof typeof MARK_LEGEND) => d(`mark.${m}`),
    document: (doc: ProfileDocument) => d(`document.${doc}`),
    how: (how: PostingSource['how']) => d(`how.${how}`),
    contactRole: (role: ContactRole) => d(`contactRole.${role}`),
    approval: (mode: ApprovalMode) => d(`approval.${mode}`),
    rel: (rel: Rel) => d(`rel.${rel}`),
    provider: (id: ProviderId) => d(`provider.${id}`),
    approvalSaid: (mode: ApprovalMode) => d(`approvalSaid.${mode}`),
    /** A `FunnelStep.stage`, as `statsFor` writes it. Unknown text is shown as is. */
    funnel: (stage: string) => {
      const key = FUNNEL_KEYS.get(stage)
      return key === undefined ? stage : d(key)
    },
    /** An `OutcomeBand.label`. */
    band: (label: string) => {
      const key = BAND_KEYS.get(label)
      return key === undefined ? label : d(key)
    },
    /** A `Comparison.dimension`. */
    dimension: (english: string) => {
      const key = DIMENSION_KEYS.get(english)
      return key === undefined ? english : d(key)
    },
    /** A headline tile's words, from its figures — `Kpi.label`/`value`/`note`/`typical` in any language. */
    kpi: (k: Pick<Kpi, 'id' | 'facts' | 'value'>) => {
      const { count, of, typical, median } = k.facts
      if (k.id === 'reply') {
        return {
          label: d('kpi.label.reply'),
          value: median === null ? k.value : d('kpi.days', { count: median }),
          note: median === null ? d('kpi.note.replyNone') : d('kpi.note.reply', { count }),
          typical: d('kpi.typicalDays', { days: d('kpi.days', { count: typical }) }),
        }
      }
      return {
        label: d(`kpi.label.${k.id}`),
        value: k.value,
        note: d(`kpi.note.${k.id}`, { count, of }),
        typical: d('kpi.typicalRate', { value: typical }),
      }
    },
    /** 1-based, as `CalendarDay.month` is. */
    month: (month: number) => d(`month.${String(month)}`),
    /** 1-based; the month beside a day number ('November 5', «5 ноября»). */
    monthOfDay: (month: number) => d(`monthOfDay.${String(month)}`),
    /** 1-based; 'Nov', 'nov.', '11月'. */
    monthShort: (month: number) => d(`monthShort.${String(month)}`),
    /** 'November 2026', 'noviembre de 2026', '2026年11月'. */
    monthYear: (month: number, year: number) =>
      d('monthYear', { month: d(`month.${String(month)}`), year }),
    /**
     * The same, in order, as pieces — so a heading can style the year apart
     * (muted) without assuming it comes last.
     */
    monthYearParts: (month: number, year: number): { text: string; isYear: boolean }[] =>
      d('monthYear', { month: d(`month.${String(month)}`), year: YEAR_MARK })
        .split(YEAR_MARK)
        .flatMap((text, i) => [
          ...(i === 0 ? [] : [{ text: String(year), isYear: true }]),
          ...(text === '' ? [] : [{ text, isYear: false }]),
        ]),
    /** 'Nov 3', '3 nov.', '11月3日'. */
    dayMonth: (month: number, day: number) =>
      d('dayMonth', { month: d(`monthShort.${String(month)}`), day }),
    /** `shortDate`: 'Nov 15', '15 nov.', '11月15日'. */
    shortDate: (iso: string) => shortDate(iso),
    /** `agoLabel`: 'today' · 'yesterday' · '5 days ago' · 'Sep 21'. Leads lowercase. */
    ago: (iso: string, today: string) => ago(iso, today),
    /**
     * `relativeLabelOn` / `whenLabel`'s tail: 'Today' · 'Tomorrow' · 'in 4 days' ·
     * '8 days overdue'. `inline` writes Today and Tomorrow for the middle of a
     * sentence, where English lowercases them.
     */
    relative: (today: string, iso: string, opts: { inline?: boolean } = {}) => relative(today, iso, opts),
    /**
     * `bucketLabel` from `frequency.ts`: a chart bucket's key read as its axis
     * label — the week's Monday ('Nov 16'), the month ('Nov'), the quarter ('Q3 2026').
     */
    bucketLabel: (key: string, period: Period) => {
      if (period === 'week') return shortDate(key)
      if (period === 'month') return d(`monthShort.${String(Number(key.slice(5, 7)))}`)
      return d('quarter', { quarter: key.slice(6), year: key.slice(0, 4) })
    },
    /** `whenLabel`: the relative tail, or 'Completed 3 days ago' once done. */
    when: (
      item: Pick<TimelineItem, 'date' | 'completedOn'>,
      today: string,
      opts: { inline?: boolean } = {},
    ) => {
      if (!item.completedOn) return relative(today, item.date, opts)
      const gap = daysBetween(item.completedOn, today)
      if (gap === 0) return d('date.completed.today')
      if (gap === 1) return d('date.completed.yesterday')
      if (gap > 1 && gap < 14) return d('date.completed.days', { count: gap })
      return d('date.completed.on', { date: shortDate(item.completedOn) })
    },

    /** The priority deck's words. See `react/use-priority.ts`. */
    priority: {
      kind: (kind: keyof typeof DOMAIN_EN.priority.kind) => d(`priority.kind.${kind}`),
      headline: (id: keyof typeof DOMAIN_EN.priority.headline, org: string) =>
        d(`priority.headline.${id}`, { org }),
      /** 'Due Nov 3 · in 4 days', with the date and its relative reading. */
      timing: (
        id: Exclude<keyof typeof DOMAIN_EN.priority.timing, 'none'>,
        today: string,
        iso: string,
      ) => d(`priority.timing.${id}`, { date: shortDate(iso), when: relative(today, iso, {}) }),
      noDate: () => d('priority.timing.none'),
      button: (id: keyof typeof DOMAIN_EN.priority.button) => d(`priority.button.${id}`),
      undatedInterview: () => d('priority.undatedInterview'),
      unfiled: () => d('priority.unfiled'),
      unknownOrg: () => d('priority.unknownOrg'),
    },

    /** 0 = Monday; 'M', 'L', '月', 'ن'. */
    weekdayNarrow: (index: number) => d(`weekdayNarrow.${String(index)}`),
    /** 0 = Monday, the order `WEEKDAYS` and the calendar grid use. */
    weekdayShort: (index: number) => d(`weekdayShort.${String(index)}`),
    /** 0 = Sunday, the order `Date.prototype.getDay` returns. */
    weekday: (day: number) => d(`weekday.${String(day)}`),

    /**
     * A stored `lastAction`, shown in the viewer's language when it is one of
     * the phrases the app writes, and exactly as stored when it is anything
     * else — a reference the person typed, an older build's wording.
     */
    action: (stored: string) => {
      const key = ACTION_KEYS.get(stored)
      return key === undefined ? stored : d(key)
    },

    /** 'filed under Rice and Baylor', or 'unfiled'. Names are display names. */
    filedUnder: (names: readonly string[]) =>
      names.length === 0
        ? d('filed.none')
        : names.length === 1
          ? d('filed.one', { a: names[0] })
          : names.length === 2
            ? d('filed.two', { a: names[0], b: names[1] })
            : d('filed.many', { count: names.length }),

    /** 'Read by gemma_4_31b · 3 days ago' (`useFit().readNote`). */
    readBy: (model: string, day: string, today: string) =>
      d('readBy', { model, ago: ago(day, today) }),
    missingSource: () => d('missingSource'),

    /** 'Rice — CS and Baylor', '3 applications', or '' for none. Names are display names. */
    picked: (names: readonly string[]) =>
      names.length === 0
        ? ''
        : names.length === 1
          ? (names[0] ?? '')
          : names.length === 2
            ? d('picked.two', { a: names[0], b: names[1] })
            : d('picked.many', { count: names.length }),

    /** The profile-read offer's title and body. See `DOMAIN_EN.twinOffer`. */
    twinOffer: (gaps: readonly Pick<TwinGap, 'subject'>[]) => {
      const first = gaps[0]?.subject ?? d('twinOffer.unnamed')
      return {
        title:
          gaps.length <= 1
            ? d('twinOffer.title', { first })
            : d('twinOffer.titleMore', { first, count: gaps.length - 1 }),
        body: d('twinOffer.body'),
      }
    },

    /** Why Save stopped on a duplicate, naming the record already tracked. */
    duplicate: (reason: DuplicateOf<unknown>['reason'], name: string) =>
      d(`duplicate.${reason}`, { name }),

    /** Why a captured page was not kept. */
    captureRejected: (reason: CaptureRejection) => d(`captureRejected.${reason}`),

    /** The undo and redo toasts. See `DOMAIN_EN.undo`. */
    undo: {
      /** A refused step, from the runtime's English message; anything unknown reads as "nothing to". */
      refused: (direction: 'undo' | 'redo', english: string | undefined) =>
        english === DOMAIN_EN.undo.changed[direction]
          ? d(`undo.changed.${direction}`)
          : d(`undo.nothing.${direction}`),
      done: (direction: 'undo' | 'redo') => d(`undo.done.${direction}`),
      /**
       * The journal label under Undone, or undefined to leave it out: a label
       * this table knows is said in the language on screen, and any other is
       * stored English, shown only where English is the language.
       */
      journal,
      action: () => d('undo.action'),
      /**
       * The title and description of a declined Undo. `reverted` is how many
       * entries did go back (none or some); `labels` are the stored English
       * labels of the ones left alone, each said through `journal`, so a label
       * this language cannot say drops out rather than showing English.
       */
      superseded: (reverted: number, labels: readonly string[]) => {
        const named = labels.flatMap((label) => journal(label) ?? [])
        return {
          title: d(reverted === 0 ? 'undo.superseded.nothing' : 'undo.superseded.part'),
          description:
            named.length === 0
              ? d('undo.superseded.unnamed')
              : d('undo.superseded.named', { labels: named.join(d('undo.superseded.separator')) }),
        }
      },
    },
    /** A shared tool's refusal toast. */
    write: {
      refused: () => d('write.refused'),
      didNotFit: () => d('write.didNotFit'),
    },
    /** A tool's announcement title, when it is one this table knows. Anything else is shown as is. */
    announce: (english: string) => {
      const key = ANNOUNCE_KEYS.get(english)
      return key === undefined ? english : d(key)
    },
    /**
     * `handoverSentence`, in the language on screen. The day count is its own
     * counted phrase (`date.ago.days`) set into the sentence as `{{ago}}`: the
     * drifted sentence's plural is the number of changes, and one sentence
     * cannot be counted by two numbers — so Arabic wrote one noun for 'days'
     * whatever the number was.
     */
    handover: (status: HandoverStatus) => {
      if (status.state === 'never') return d('handover.never')
      const when = status.days === 0 ? 'today' : status.days === 1 ? 'yesterday' : 'daysAgo'
      const ago = when === 'daysAgo' ? d('date.ago.days', { count: status.days }) : undefined
      if (status.state === 'clean') return d(`handover.clean.${when}`, { ago })
      return d(`handover.drifted.${when}`, { count: status.writes, ago })
    },

    /** `describeBackup`, in the language on screen. */
    backup: (plan: RestorePlan) => {
      const loss =
        plan.loss ??
        lossOf(plan.nodes, plan.edges, validateRows(plan.nodes, plan.edges, { salvage: true }))
      const counts = {
        records: d('backup.records', { count: plan.nodes.length }),
        links: d('backup.links', { count: plan.edges.length }),
        documents: d('backup.documents', { count: plan.documents.length }),
      }
      const unread = [
        ...(loss.records > 0 ? [d('backup.records', { count: loss.records })] : []),
        ...(loss.links > 0 ? [d('backup.links', { count: loss.links })] : []),
      ]
      const leftOut =
        unread.length === 0
          ? null
          : d('backup.leftOut', {
              what: unread.length === 2 ? d('backup.both', { a: unread[0], b: unread[1] }) : unread[0],
            })
      const changed = loss.changed > 0 ? d('backup.changed', { count: loss.changed }) : null
      const said =
        leftOut !== null && changed !== null
          ? d('backup.leftOutAndChanged', { leftOut, changed })
          : (leftOut ?? changed)
      return said === null ? d('backup.summary', counts) : d('backup.summaryLoss', { ...counts, loss: said })
    },

    /** `replacesClause`, in the language on screen, for where the restore lands. */
    replaces: (plan: RestorePlan, where: RestoreWhere) => {
      const kept = keptDocuments(plan.nodes, plan.documents).size
      return kept === 0
        ? d(`backup.replacesAll.${where}`)
        : d(`backup.replacesKept.${where}`, { count: kept })
    },
  }
}

export type DomainText = ReturnType<typeof domainText>
