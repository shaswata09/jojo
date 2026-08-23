import { describe, expect, it } from 'vitest'
import { TOOLS } from '@jojo/service/tools/index'
import type { AnyTool } from '@jojo/service/tools/tool'
import { buildInput, humanise, initialValues, optionLabel, planToolForm } from './tool-form'
import type { CountOf, FormPlan } from './tool-form'

/** Enough of everything, unless a test is about the empty case. */
const plenty: CountOf = () => 3
const nothing: CountOf = () => 0

const planOf = (
  name: keyof typeof TOOLS,
  countOf: CountOf = plenty,
  seeded?: Record<string, unknown>,
) => {
  const tool: AnyTool = TOOLS[name]
  return planToolForm(tool, { countOf, ...(seeded ? { seeded } : {}) })
}

/** A plan the assertions can lean on, rather than `plan!` in twenty places. */
const required = (
  name: keyof typeof TOOLS,
  countOf: CountOf = plenty,
  seeded?: Record<string, unknown>,
) => {
  const plan = planOf(name, countOf, seeded)
  if (!plan) throw new Error(`${name} should have been plannable`)
  return plan
}

const keys = (plan: FormPlan) => plan.fields.map((f) => f.key)

describe('planToolForm', () => {
  it('withholds internal and admin tools', () => {
    // `org.ensure` says `internal: true`; `memory.reset` is `undoable: false`
    // and belongs to Settings' confirmation dialog, not to a one-Enter row.
    expect(planOf('org.ensure')).toBeNull()
    expect(planOf('memory.reset')).toBeNull()
    expect(planOf('memory.clear')).toBeNull()
  })

  it('withholds a tool whose required field has no control', () => {
    // `files` is an array of objects — a file picker, not a text box.
    expect(planOf('vault.file.add')).toBeNull()
    // `record` is `s.id()` with no node type, so the picker has no scope.
    expect(planOf('keyword.attach')).toBeNull()
    expect(planOf('keyword.record.set')).toBeNull()
  })

  it('names the optional fields it left off instead of dropping them silently', () => {
    const plan = required('application.create')
    expect(plan.omitted).toEqual(['Keywords'])
    expect(keys(plan)).not.toContain('keywords')
  })

  it('says nothing about an omitted field the schema never labelled', () => {
    // `mint` is the timeline item a transition may raise. It has no label
    // because it was never a question to put to anyone.
    const plan = required('application.stage.advance', plenty, { id: 'app:x' })
    expect(plan.omitted).toEqual([])
    expect(keys(plan)).not.toContain('mint')
  })

  it('withholds a tool whose only picker would be empty', () => {
    expect(planOf('vault.link.delete', nothing)).toBeNull()
    expect(planOf('vault.link.delete', plenty)).not.toBeNull()
  })

  it('leaves an OPTIONAL empty picker off the form and keeps the tool', () => {
    // No applications yet, but a reminder can still be filed — it just cannot
    // be filed against anything.
    const plan = required('timeline.item.create', nothing)
    // Plural since `ABOUT` became many-to-many: an item can be about several
    // applications, so the field is a list and the label says so.
    expect(keys(plan)).not.toContain('applicationIds')
    expect(plan.omitted).toContain('Applications')
  })

  it('puts the required fields first and keeps schema order inside each half', () => {
    const plan = required('application.create')
    const firstOptional = plan.fields.findIndex((f) => !f.required)
    expect(plan.fields.slice(0, firstOptional).map((f) => f.key)).toEqual([
      'org',
      'role',
      'roleTag',
      'stage',
    ])
    expect(plan.fields.every((f, i) => i < firstOptional || !f.required)).toBe(true)
  })

  it('drops seeded fields from the form', () => {
    const plan = required('application.stage.set', plenty, { id: 'app:x' })
    expect(keys(plan)).toEqual(['stage'])
  })

  it('reads the control off the schema, not off the field name', () => {
    const plan = required('application.note.set', plenty, { id: 'app:x' })
    // `note` is `s.string({ multiline: true })`, so it is a textarea.
    expect(plan.fields[0]?.control).toBe('textarea')
    expect(required('timeline.item.snooze', plenty, { id: 'i:x' }).fields[0]?.control).toBe(
      'number',
    )
    expect(required('application.flag.set', plenty, { id: 'app:x' }).fields[0]?.control).toBe(
      'boolean',
    )
    expect(required('vault.link.recategorise', plenty, { id: 'l:x' }).fields[0]?.control).toBe(
      'enum',
    )
    expect(required('timeline.item.reschedule', plenty, { id: 'i:x' }).fields[0]?.control).toBe(
      'date',
    )
  })
})

describe('buildInput', () => {
  it('leaves an optional field the user never touched out entirely', () => {
    const plan = required('application.update', plenty, { id: 'app:x' })
    const input = buildInput(plan, initialValues(plan), new Set(), { id: 'app:x' })
    // The whole tool is optional past `id`, so an untouched form is a no-op —
    // and in particular `flagged: false` is absent rather than unflagging a
    // record the user only opened to look at.
    expect(input).toEqual({ id: 'app:x' })
    expect('flagged' in input).toBe(false)
  })

  it('sends null for a nullable field the user emptied', () => {
    const plan = required('application.update', plenty, { id: 'app:x' })
    const values = { ...initialValues(plan), deadline: '' }
    const input = buildInput(plan, values, new Set(['deadline']), { id: 'app:x' })
    // Absent leaves the deadline alone; null takes it off. A form that could
    // only add one would be a form that could never remove one.
    expect(input).toEqual({ id: 'app:x', deadline: null })
  })

  it('leaves a touched-but-blank field out when it cannot be cleared', () => {
    const plan = required('application.create')
    const input = buildInput(plan, { ...initialValues(plan), location: '' }, new Set(['location']))
    expect('location' in input).toBe(false)
  })

  it('submits a required field however blank, so the schema writes the message', () => {
    const plan = required('application.create')
    const parsed = TOOLS['application.create'].input.parse(
      buildInput(plan, initialValues(plan), new Set()),
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.issues.map((i) => i.path)).toContain('org')
      expect(parsed.issues.find((i) => i.path === 'org')?.message).toBe('Cannot be blank.')
    }
  })

  it('turns a blank number into NaN rather than zero', () => {
    const plan = required('timeline.item.snooze', plenty, { id: 'i:x' })
    const input = buildInput(plan, { days: '' }, new Set(['days']), { id: 'i:x' })
    // `Number('')` is 0, and a snooze of zero days would report success having
    // moved nothing. The schema rejects a non-finite number in the user's words.
    expect(Number.isNaN(input.days)).toBe(true)
  })

  it('builds an object the tool’s own schema accepts', () => {
    const plan = required('application.create')
    const values = {
      ...initialValues(plan),
      org: 'Rice',
      role: 'Statistics',
      roleTag: 'Assistant Professor',
      stage: 'draft',
      deadline: '2026-11-15',
    }
    const input = buildInput(plan, values, new Set(['deadline']))
    const parsed = TOOLS['application.create'].input.parse(input)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.deadline).toBe('2026-11-15')
  })
})

describe('labels', () => {
  it('humanises only the keys whose schema named no label', () => {
    expect(humanise('roleTag')).toBe('Role tag')
    expect(humanise('applicationId')).toBe('Application id')
  })

  it('capitalises an option without retitling it', () => {
    // 'Job board' must not become 'Job Board', which is not what any other
    // screen in the app prints.
    expect(optionLabel('draft')).toBe('Draft')
    expect(optionLabel('Job board')).toBe('Job board')
  })
})
