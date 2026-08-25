/**
 * A form, planned from a tool's `FieldMeta` — no React, so it is testable.
 *
 * The `FieldMeta` header in `core/schema.ts` says it was kept introspectable "so the command
 * palette can generate a form from a tool's input schema". This is that reader.
 * It is deliberately the only place that decides what a generated form can and
 * cannot draw, because the palette and `/graph` both ask the question and an
 * answer that differed between them would put a tool in one surface and not the
 * other for no reason a user could see.
 *
 * The rule for what appears: a tool is offered only when every REQUIRED field
 * has a control. An optional field with no control is left off the form and
 * named underneath it, which is honest — the tool runs, that field stays absent,
 * and the user is told. A required one cannot be filled at all, so the tool is
 * withheld rather than shown with a field that does nothing.
 *
 * Nothing here validates. `runtime.check` does that against the tool's own
 * schema, so the message under a field is the sentence the schema author wrote
 * and a generated form can never disagree with the tool it submits to — the
 * failure the `FieldMeta` header in `kg/core/schema.ts` names.
 */

import { displayName } from '@/data/seed'
import type { NodeType, StoredNode } from '@jojo/service/core/model'
import type { FieldMeta } from '@jojo/service/core/schema'
import { labelOf } from '@jojo/service/core/ontology'
import type { GraphSnapshot } from '@jojo/service/core/snapshot'
import type { AnyTool } from '@jojo/service/tools/tool'

/** What to render. One per field the form can honestly draw. */
export type Control = 'text' | 'textarea' | 'number' | 'boolean' | 'enum' | 'date' | 'record'

export type FieldPlan = {
  key: string
  label: string
  control: Control
  required: boolean
  /** `record` only — which kind of record the picker lists. */
  nodeType?: NodeType
  /** `enum` only. */
  options?: readonly (string | number | boolean)[]
  description?: string
  placeholder?: string
  /**
   * Blanking this field sends `null` rather than leaving it out.
   *
   * `application.update.deadline` is `optional(nullable(isoDate))` and the two
   * halves mean different things — absent leaves the deadline alone, `null`
   * removes it. Without this the generated form could add a deadline and never
   * take one away.
   */
  clearable: boolean
}

export type FormPlan = {
  tool: AnyTool
  fields: FieldPlan[]
  /**
   * Optional fields this form cannot draw, by label, for saying so underneath.
   *
   * A quick create that silently dropped keywords would look like a create that
   * had lost them. Only the fields whose schema gave a `label` are named: an
   * unlabelled one was never written to be shown to a person — `mint` on
   * `application.stage.advance` is the timeline item the transition may raise —
   * and printing its key would put a word in front of the user that the tool
   * never chose and that names nothing they can act on.
   */
  omitted: string[]
}

/**
 * How many records of a type exist, for the pickers.
 *
 * Passed in rather than read from a snapshot because this module has no
 * business holding one, and because it is what makes the empty case testable:
 * `vault.link.delete` must not be offered when there are no links to delete.
 */
export type CountOf = (type: NodeType) => number

/** 'roleTag' -> 'Role tag'. Only for the fields whose schema names no label. */
export function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/**
 * 'draft' -> 'Draft'. First letter only.
 *
 * The enum values in this app are already written for people — 'Job board',
 * 'Assistant Professor' — and the handful that are not are single lowercase
 * words. Title-casing the whole string would turn 'Job board' into 'Job Board'
 * and quietly disagree with every other place the same value is printed.
 */
export const optionLabel = (value: string | number | boolean): string => {
  const text = String(value)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function controlFor(meta: FieldMeta): Control | null {
  switch (meta.kind) {
    case 'string':
      return meta.multiline ? 'textarea' : 'text'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'enum':
      return 'enum'
    case 'date':
      return 'date'
    case 'id':
      // Without `nodeType` the picker has nothing to scope itself to, and a
      // list of every record in the store is not a picker. `keyword.attach`'s
      // `record` is the one that lands here, and it is required — so that tool
      // is withheld rather than offered with a field nobody can fill.
      return meta.nodeType === undefined ? null : 'record'
    // 'instant', 'literal', 'array', 'object', 'record' and 'unknown' have no
    // honest single control. Every one of them in the registry today is
    // optional, so they are named under the form rather than blocking the tool.
    default:
      return null
  }
}

function planField(key: string, meta: FieldMeta, countOf: CountOf): FieldPlan | null {
  const control = controlFor(meta)
  if (control === null) return null
  if (control === 'record' && meta.nodeType !== undefined && countOf(meta.nodeType) === 0) {
    return null
  }

  return {
    key,
    label: meta.label ?? humanise(key),
    control,
    required: meta.optional !== true,
    ...(meta.nodeType === undefined ? {} : { nodeType: meta.nodeType }),
    ...(meta.options === undefined ? {} : { options: meta.options }),
    ...(meta.description === undefined ? {} : { description: meta.description }),
    ...(meta.placeholder === undefined ? {} : { placeholder: meta.placeholder }),
    clearable: meta.nullable === true,
  }
}

/**
 * The form for one tool, or `null` when there cannot honestly be one.
 *
 * `internal` tools are absent from every surface by their own declaration.
 * `admin` ones are absent because they are `undoable: false` and Settings owns
 * them behind a confirmation dialog (`pendingCopy` in
 * `components/settings/data-confirm-copy.tsx`) — offering "Load
 * demo data" as a one-Enter palette row would delete a user's records with no
 * undo and no question asked.
 *
 * `seeded` keys are dropped from the form: `/graph` already knows which record
 * the verb is about, and re-asking for it in a picker is a question with one
 * right answer.
 */
export function planToolForm(
  tool: AnyTool,
  opts: { countOf: CountOf; seeded?: Readonly<Record<string, unknown>> },
): FormPlan | null {
  if (tool.internal === true) return null
  if (tool.effect === 'admin') return null

  const shape = tool.input.meta.fields
  if (tool.input.meta.kind !== 'object' || !shape) return null

  const fields: FieldPlan[] = []
  const omitted: string[] = []

  for (const [key, meta] of Object.entries(shape)) {
    if (opts.seeded && key in opts.seeded) continue

    const field = planField(key, meta, opts.countOf)
    if (field) {
      fields.push(field)
      continue
    }
    if (meta.optional === true) {
      if (meta.label !== undefined) omitted.push(meta.label)
      continue
    }
    return null
  }

  // Required first, and otherwise in schema order — which is the order the tool
  // author wrote them in, and reads as a form rather than as an alphabetised
  // list of properties. A stable partition, so it is not a sort.
  return {
    tool,
    fields: [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)],
    omitted,
  }
}

/* ------------------------------ record picker ----------------------------- */

/**
 * One record, in a line, for a picker.
 *
 * Not `buildGraph`'s `describe` (`lib/graph/build.ts`), which dresses a record for
 * the canvas: it also mints an href, a detail line and an item kind, it draws
 * nothing for `pipeline` or `profile`, and it walks every node and edge in the
 * store to answer a question about one type. A picker needs a name.
 */
export function recordLabel(memory: GraphSnapshot, node: StoredNode): string {
  switch (node.type) {
    case 'application': {
      const org = memory.one(node.id, 'AT', 'organisation')?.props.name ?? ''
      return displayName({ org, role: node.props.role })
    }
    case 'claim': {
      /*
       * The sentence rather than the predicate. A picker offering "EVIDENCES"
       * three times is a picker nobody can choose from — the predicate is the
       * least distinguishing part of a relation, and both ends are what tell
       * two of them apart.
       */
      const end = (rel: 'SUBJECT' | 'OBJECT') => {
        const other = memory.out(node.id, rel)[0]?.to
        const found = other === undefined ? undefined : memory.node(other)
        return found === undefined ? 'a record' : recordLabel(memory, found)
      }
      return `${end('SUBJECT')} ${labelOf(node.props.predicate)} ${end('OBJECT')}`
    }
    case 'thread':
      return node.props.title
    case 'organisation':
      return node.props.name
    case 'timelineItem':
      return node.props.title
    case 'keyword':
      return node.props.name
    case 'link':
      return node.props.title
    case 'file':
      return node.props.name
    case 'snippet':
      return node.props.title
    case 'person':
      return node.props.name
    case 'background':
      // The title alone. 'PhD, Computer Science — University of Illinois' is a
      // record; in a picker it is a line that wraps and stops being scannable.
      return node.props.title
    case 'posting':
      return node.props.title
    case 'match':
      return node.props.role
    case 'pipeline':
      return node.props.name
    case 'proposal':
      return node.props.title
    case 'profile':
      // Singleton, and the only node whose props hold no name of its own.
      return 'Your profile'
  }
}

export type RecordOption = { id: string; label: string }

/** Sorted by what is on screen, so the picker reads alphabetically. */
export function recordOptions(memory: GraphSnapshot, type: NodeType): RecordOption[] {
  return memory
    .ofType(type)
    .map((node) => ({ id: node.id, label: recordLabel(memory, node) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/* --------------------------------- values --------------------------------- */

/** Every control's state as one of two primitives; booleans are the switches. */
export type FormValues = Readonly<Record<string, string | boolean>>

export function initialValues(plan: FormPlan): FormValues {
  const values: Record<string, string | boolean> = {}
  for (const field of plan.fields) values[field.key] = field.control === 'boolean' ? false : ''
  return values
}

/**
 * The input object, from what was typed.
 *
 * `touched` is what makes an optional field mean "leave it alone". Every
 * optional field starts at a value — '' or `false` — and a form that submitted
 * all of them would send `flagged: false` to `application.update` and unflag a
 * record the user had only opened to rename. So an optional field the user
 * never went near is left out entirely, which is what absent means to the tool.
 *
 * A required field is submitted however blank it is: the schema's own message —
 * 'Cannot be blank.', 'Needs to be one of: …' — is a better sentence than
 * anything this module could invent, and it is the one the tool would have
 * produced anyway.
 */
export function buildInput(
  plan: FormPlan,
  values: FormValues,
  touched: ReadonlySet<string>,
  seeded?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...seeded }

  for (const field of plan.fields) {
    const raw = values[field.key]
    const optional = !field.required

    if (field.control === 'boolean') {
      if (optional && !touched.has(field.key)) continue
      input[field.key] = raw === true
      continue
    }

    const text = typeof raw === 'string' ? raw.trim() : ''

    if (optional && !touched.has(field.key)) continue
    if (optional && text === '') {
      // Touched and emptied. On a nullable field that is the only way to say
      // "remove this"; on the rest it is indistinguishable from never having
      // typed, so the field stays absent.
      if (field.clearable) input[field.key] = null
      continue
    }

    if (field.control === 'number') {
      // NaN rather than 0: `Number('')` is 0, and a blank "Snooze by" that
      // arrived as `days: 0` would have moved the item nowhere and reported
      // success. The schema rejects a non-finite number in the user's words.
      input[field.key] = text === '' ? Number.NaN : Number(text)
      continue
    }

    input[field.key] = text
  }

  return input
}

/**
 * Which field an issue belongs under.
 *
 * `Issue.path` is 'offer.respondBy' or 'keywords[2]' once it is inside a nested
 * value, and this form only ever draws flat ones — so the first segment is the
 * field to look up, and a path whose first segment names nothing on the form
 * belongs to a field the form did not draw and is shown above it instead.
 */
export function fieldOfPath(path: string): string {
  return path.split(/[.[]/)[0] ?? path
}
