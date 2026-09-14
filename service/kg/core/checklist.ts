/**
 * An application's checklist, as plain values. L1 core.
 *
 * ## EVERY FUNCTION HERE RETURNS NEW OBJECTS AND MUTATES NOTHING
 *
 * That is the first sentence because it is the one mistake this feature is most
 * likely to ship. `tx.patch` copies a record's props SHALLOWLY
 * (`tools/runtime-tx.ts`), so the array it stages as the journal's before-image
 * is the very array it stages as the after-image. A `list.push(item)` or an
 * `item.doneOn = day` anywhere in the write path therefore edits both sides of
 * the undo at once: pressing Undo restores what is already there, does nothing,
 * and says it worked. Nothing about the screen would look wrong until somebody
 * needed the undo.
 *
 * So the list is rebuilt here and only here, and `checklist.test.ts` asserts
 * non-mutation on every function rather than trusting this paragraph.
 *
 * ## Why the rules are in core rather than in the tool
 *
 * Under D20 the panel cannot be mounted, so anything decided inside a component
 * is decided where no test can reach it. Three rules matter to a person and all
 * three are here: what counts as the same step already being on the list, when
 * the add box must refuse and what it says, and what ticking does to a line
 * that is already ticked.
 */

import { dayOf } from './project'
import { fold } from './text'
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT } from './model'
import type { ChecklistItem, Instant } from './model'

/** Nothing yet is the same as an empty list, everywhere but on disk. */
export const itemsOf = (list: readonly ChecklistItem[] | undefined): readonly ChecklistItem[] =>
  list ?? []

/**
 * What makes two steps the same step.
 *
 * Folded for case and accents like every other name comparison in the app, and
 * then stripped of the punctuation people vary without meaning to: "Email the
 * chair." and "email the chair" are one line, and a model asked twice will
 * write both. Trailing punctuation only — an interior full stop is part of the
 * phrase ("Ask Dr. Rao for a letter").
 */
export const keyOf = (text: string): string =>
  fold(text)
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim()

/** How many are still open, and how many there are. What the card's hint says. */
export const openCount = (list: readonly ChecklistItem[] | undefined): number =>
  itemsOf(list).filter((i) => i.doneOn === undefined).length

/** How many more will fit. Zero when the list is full. */
export const roomFor = (list: readonly ChecklistItem[] | undefined): number =>
  Math.max(0, MAX_CHECKLIST_ITEMS - itemsOf(list).length)

/**
 * Why the add box cannot accept this, or null when it can.
 *
 * The sentence is returned rather than a code, because it is shown twice — on
 * the disabled control (the law: a disabled control must say why) and by the
 * tool when it refuses the same write. One rule, one wording, one test.
 */
export function addBlocker(
  list: readonly ChecklistItem[] | undefined,
  text: string,
): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (trimmed.length > MAX_CHECKLIST_TEXT) {
    return `A step has to fit in ${String(MAX_CHECKLIST_TEXT)} characters. This one is ${String(trimmed.length)}.`
  }
  if (roomFor(list) === 0) {
    return `${String(MAX_CHECKLIST_ITEMS)} steps is the most one application holds. Tick off or delete one first.`
  }
  if (itemsOf(list).some((i) => keyOf(i.text) === keyOf(trimmed))) {
    return 'That step is already on the list.'
  }
  return null
}

/**
 * Add steps to the end, dropping the ones already there.
 *
 * APPENDS, never replaces, and never touches an existing item — which is what
 * makes "Draft more" safe to press on a list somebody has been working through.
 * The person's ticks are unreachable from here by construction.
 *
 * Duplicates are dropped silently rather than refused: asking for a checklist
 * twice should leave one checklist, and a model that repeats itself is the
 * ordinary case rather than an error worth stopping for.
 */
export function addItems(
  list: readonly ChecklistItem[] | undefined,
  texts: readonly string[],
  ids: readonly string[],
  by?: { model: string; at: Instant },
): readonly ChecklistItem[] {
  const existing = itemsOf(list)
  const seen = new Set(existing.map((i) => keyOf(i.text)))
  const added: ChecklistItem[] = []
  for (const [index, raw] of texts.entries()) {
    if (existing.length + added.length >= MAX_CHECKLIST_ITEMS) break
    const text = raw.trim()
    const id = ids[index]
    if (text === '' || text.length > MAX_CHECKLIST_TEXT || id === undefined) continue
    const key = keyOf(text)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    added.push({ id, text, ...(by === undefined ? {} : { by }) })
  }
  // The SAME array back when nothing was added, so a tool can return without
  // staging a write that changes nothing.
  if (added.length === 0) return existing
  return [...existing, ...added]
}

/**
 * Change one step. Unknown ids are a no-op, as every other mutator here is.
 *
 * `done` is ABSOLUTE, not a toggle. `tools/timeline.ts` argues this at length
 * for the same control: an instruction to invert whatever it finds races the
 * screen that issued it, and the second of two quick taps then undoes the first.
 *
 * Ticking something already ticked does NOT restamp the day. `fit.reading.clear`
 * learned this one: the stamp is when the person decided, not when they last
 * pressed.
 */
export function setItem(
  list: readonly ChecklistItem[] | undefined,
  itemId: string,
  change: { text?: string; done?: boolean },
  now: Instant,
): readonly ChecklistItem[] {
  const existing = itemsOf(list)
  const at = existing.findIndex((i) => i.id === itemId)
  const item = existing[at]
  if (item === undefined) return existing

  const text = change.text === undefined ? item.text : change.text.trim()
  if (text === '' || text.length > MAX_CHECKLIST_TEXT) return existing

  const doneOn =
    change.done === undefined
      ? item.doneOn
      : change.done
        ? (item.doneOn ?? dayOf(now))
        : undefined

  if (text === item.text && doneOn === item.doneOn) return existing

  const next: ChecklistItem = {
    id: item.id,
    text,
    // D21: the key is added or it is absent. A stored `undefined` would survive
    // as a present key and `'doneOn' in item` would answer yes for something
    // nobody has done.
    ...(doneOn === undefined ? {} : { doneOn }),
    ...(item.by === undefined ? {} : { by: item.by }),
  }
  // Every other element is handed back by reference, so a re-render can tell
  // which row actually moved.
  return existing.map((i, index) => (index === at ? next : i))
}

/** Drop one step, keeping the order of the rest. Unknown ids are a no-op. */
export function removeItem(
  list: readonly ChecklistItem[] | undefined,
  itemId: string,
): readonly ChecklistItem[] {
  const existing = itemsOf(list)
  if (!existing.some((i) => i.id === itemId)) return existing
  return existing.filter((i) => i.id !== itemId)
}

/**
 * The head AND the tail of a posting, with the middle named.
 *
 * `read-requirements.ts` takes the first 12,000 characters because what a job
 * ASKS FOR sits near the top. What a job asks you to SEND does not: "three
 * letters through Interfolio", "quote requisition PR-4012", "a diversity
 * statement of no more than one page" live under How to apply, at the bottom,
 * under the equal-opportunity boilerplate. A head-only cut of a long university
 * advertisement throws away the single most useful paragraph for this feature.
 *
 * The marker is left in the text rather than the two halves being joined
 * silently, and the prompt is told what it means, so a model does not read the
 * tail as continuing the head.
 */
export function postingSlice(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text
  const cut = text.length - head - tail
  return `${text.slice(0, head)}\n\n[… ${String(cut)} characters not shown …]\n\n${text.slice(text.length - tail)}`
}
