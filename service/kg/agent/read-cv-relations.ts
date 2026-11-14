/**
 * L3 — how the facts read from a document relate: the relations prompt, and
 * the reply turned into position-addressed drafts.
 *
 * Part of `read-cv.ts`, which re-exports every name exported here. Runs after
 * the entries are settled; see `relationMessages` for why.
 */

import { firstJsonObject } from '../core/json-reply'
import type { ChatMessage } from '../core/model-server'
import type { BackgroundDraft } from './read-cv-parse'

/* ------------------------------- relations -------------------------------- */

/**
 * One relation the model proposes, with its ends as POSITIONS in the entry list.
 *
 * Numbers, not ids, and that is the whole reason this shape exists. The records
 * do not have ids yet — nothing has been written, because the person has not
 * approved anything — and even after they do, asking a model to copy a uuidv7
 * twice per relation is asking for the one thing models reliably get wrong. A
 * number it can see in the list in front of it is a number it can get right.
 *
 * The caller maps positions to ids after the write, in the order
 * `profile.background.add` returned them.
 */
export type RelationDraft = {
  /** 0-based index into the entries the model was shown. */
  subject: number
  /** In the model's own words. `core/ontology.ts` maps it. */
  predicate: string
  object: number
}

/**
 * How much of the document the relations pass is shown.
 *
 * Smaller than `CV_BUDGET`, because this request carries the numbered entry
 * list as well as the text. The document half is the half that gets cut, and
 * that is the right way round: relations between entries are mostly derivable
 * from the entries, and a truncated document costs a few relations rather than
 * a wrong one.
 */
export const RELATIONS_BUDGET = 12_000

const RELATIONS_SYSTEM = [
  'You read a document about a person and say how the facts in it relate.',
  '',
  'You will be given a numbered list of facts already taken from the document,',
  'and the document itself. Return JSON. Nothing else:',
  '  {"relations": [{"subject": 3, "predicate": "is evidence of", "object": 7}]}',
  '',
  'subject and object are NUMBERS from the list. predicate is plain words.',
  '',
  'Say the relation however it reads most naturally — "built", "supervised",',
  '"is evidence of", "was funded by", "peer reviewed for". Do not try to guess a',
  'code or a schema name; the words are mapped afterwards.',
  '',
  'ONLY relations the document states or plainly implies. If the document says',
  '"during my postdoc at ETH I built Aurelia", then the postdoc entry and the',
  'Aurelia entry are related. If two entries merely sit near each other in the',
  'text, they are not.',
  '',
  'Do NOT relate a fact to itself. Do not repeat a relation you have already',
  'given, in either direction.',
  '',
  'Return {"relations": []} if the document states none. That is a common and',
  'correct answer for a plain list of dates.',
  '',
  'The most useful ones, when the document supports them:',
  '  - a paper or project      is evidence of   a skill',
  '  - a project               was built at     an employer',
  '  - a grant                 funded           a project',
  '  - a course                taught           a subject',
  '  - a person                supervised       a person',
].join('\n')

/**
 * The two messages for the relations pass.
 *
 * Runs after the entries are settled, not alongside them. A model asked for
 * facts AND how they relate in one reply does neither well — and the entries
 * have to be numbered before anything can point at them, which is only possible
 * once they are final.
 */
export function relationMessages(
  name: string,
  markdown: string,
  entries: readonly BackgroundDraft[],
): ChatMessage[] {
  const long = markdown.length > RELATIONS_BUDGET
  const text = long ? markdown.slice(0, RELATIONS_BUDGET) : markdown
  const listed = entries
    .map((b, i) => `${String(i + 1)}. ${b.kind}: ${b.title}${b.where === undefined ? '' : ` — ${b.where}`}`)
    .join('\n')

  return [
    { role: 'system', content: RELATIONS_SYSTEM },
    {
      role: 'user',
      content: [
        `Document: ${name}`,
        long ? '(This is the first part of a longer document.)' : '',
        '',
        'Facts:',
        listed,
        '',
        'Text:',
        text,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

/**
 * The reply, turned into drafts, refusing rather than throwing.
 *
 * Row by row like everything else here. A relation naming a fact that is not on
 * the list is dropped rather than clamped to the nearest one: a model that
 * returns `object: 40` for a list of twelve has lost track of the list, and
 * pointing that relation at entry twelve would invent a fact rather than lose
 * one.
 */
export function readRelations(reply: string, entryCount: number): RelationDraft[] {
  const payload = firstJsonObject(reply)
  const raw = (payload as { relations?: unknown } | null)?.relations
  if (!Array.isArray(raw)) return []

  const out: RelationDraft[] = []
  const seen = new Set<string>()

  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>

    const subject = position(r['subject'], entryCount)
    const object = position(r['object'], entryCount)
    const predicate = typeof r['predicate'] === 'string' ? r['predicate'].trim() : ''
    if (subject === null || object === null || predicate === '' || subject === object) continue

    /*
     * Deduped on the ENDS only, ignoring direction and predicate.
     *
     * Deliberately blunter than `core/claim.ts`, which knows about inverses and
     * can afford to. Here the aim is only to stop one reply proposing the same
     * pair four ways — a model listing "A built B" and "B was built by A" in
     * one answer is describing one relation twice, and the store's own gate
     * should not have to be the first thing that notices.
     */
    const key = [subject, object].sort((a, b) => a - b).join('|')
    if (seen.has(key)) continue
    seen.add(key)

    out.push({ subject, predicate, object })
  }
  return out
}

/** A 1-based position from the model, as a 0-based index, or null. */
function position(value: unknown, count: number): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(n) || n < 1 || n > count) return null
  return n - 1
}
