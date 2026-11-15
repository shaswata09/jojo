import { describe, expect, it } from 'vitest'
import { buildStagePatch, initialStageDraft } from '@jojo/service/core/stage-policy'
import { applicationCreateInput, applicationUpdateInput } from '@jojo/service/react/use-applications'
import type { Application } from '@/data/seed'
import { formFrom } from '@/components/applications/dialog/form-state'
import applicationDialog from '@/components/applications/ApplicationDialog.tsx?raw'
import stageDialog from '@/components/applications/StageTransitionDialog.tsx?raw'
import writes from '@/components/applications/dialog/use-application-writes.ts?raw'

/**
 * Q268 — the formatting a form's Note collects reaches the store.
 *
 * `RichNoteField` hands each form the text and the encoded formatting
 * (`common/RichTextEditorField.requests.test.ts`), and the tools keep what they
 * are sent (`service/kg/tools/rich-notes.requests.test.ts`). This is the seam
 * between: every form and hook in the path forwards the formatting rather than
 * dropping it on the floor, which is exactly how the first version of the
 * application note lost its colours. Pure functions are called; JSX and hook
 * bodies are read as source (D20), comments stripped.
 */
// The two hooks are service source, read as text through `?raw` globs: the one
// form check-no-copies allows for reaching the service from the app, because
// it instantiates no module.
const hooks = import.meta.glob(
  ['../../../../service/kg/react/use-timeline.ts', '../../../../service/kg/react/use-vault.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>
const hookSource = (name: string) =>
  Object.entries(hooks).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? ''
const useTimeline = hookSource('use-timeline.ts')
const useVault = hookSource('use-vault.ts')

const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const offerless = {
  id: 'app:1',
  org: 'Rice',
  role: 'Statistics',
  roleTag: 'Assistant Professor',
  stage: 'interview',
  note: '',
  lastAction: '',
  daysAgo: 0,
} as Application

describe('the application edit dialog (Q268)', () => {
  it('holds the note’s formatting in the form, opened from what it was given', () => {
    expect(formFrom({ note: 'Send it', noteFormat: '0-4:b::' }).noteFormat).toBe('0-4:b::')
    expect(formFrom().noteFormat).toBe('')
  })

  it('opens a record on its stored formatting and hands the field both halves', () => {
    const code = strip(applicationDialog)
    expect(code).toMatch(/encodeFormat\(graph\.node\(given\.id as NodeId, 'application'\)\?\.props\.noteFormat\)/)
    expect(code).toMatch(/noteFormat=\{form\.noteFormat\}\s*onNoteFormatChange=\{\(format\) => set\('noteFormat', format\)\}/)
  })

  it('saves it in the same call as the text, on create and on edit', () => {
    expect(strip(writes)).toMatch(/note: form\.note\.trim\(\),\s*noteFormat: form\.noteFormat,/)
    expect(applicationUpdateInput('app:1', { note: 'x', noteFormat: '0-1:b::' }, '2026-10-12')).toMatchObject({
      note: 'x',
      noteFormat: '0-1:b::',
    })
    expect(
      applicationCreateInput({ ...offerless, note: 'x', noteFormat: '0-1:b::' }),
    ).toMatchObject({ note: 'x', noteFormat: '0-1:b::' })
  })
})

describe('the offer’s note, on a stage move (Q268)', () => {
  it('carries the formatting into the move, beside the offer', () => {
    const draft = { ...initialStageDraft(offerless, '2026-10-12'), offerNote: 'Ask', offerNoteFormat: '0-3:b::' }
    const patch = buildStagePatch(offerless, 'offer', draft)
    expect(patch.offer?.note).toBe('Ask')
    expect(patch.offerNoteFormat).toBe('0-3:b::')
    expect(applicationUpdateInput('app:1', patch, '2026-10-12')).toMatchObject({ offerNoteFormat: '0-3:b::' })
  })

  it('sends none from the phone’s plain sheet, so the tool moves what is there', () => {
    const patch = buildStagePatch(offerless, 'offer', initialStageDraft(offerless, '2026-10-12'))
    expect(Object.hasOwn(patch, 'offerNoteFormat')).toBe(false)
  })

  it('opens the dialog on the stored formatting and keeps the edits', () => {
    const code = strip(stageDialog)
    expect(code).toMatch(/encodeFormat\(graph\.node\(application\.id as NodeId, 'application'\)\?\.props\.offerNoteFormat\)/)
    expect(code).toMatch(/offerNoteFormat=\{draft\.offerNoteFormat\}/)
    expect(code).toMatch(/offerNote: text, offerNoteFormat: format/)
  })
})

describe('a timeline item and a person (Q268)', () => {
  it('the timeline hook forwards the formatting on create and on edit', () => {
    const code = strip(useTimeline)
    expect(code).toMatch(/present\('noteFormat', draft\.format\)/)
    expect(code).toMatch(/present\('noteFormat', patch\.format\)/)
  })

  it('the vault hook forwards it for a person on create and on edit', () => {
    const code = strip(useVault)
    expect(code).toMatch(/present\('note', draft\.note\),\s*\.\.\.present\('noteFormat', draft\.format\)/)
    expect(code).toMatch(/present\('note', patch\.note\),\s*\.\.\.present\('noteFormat', patch\.format\)/)
  })
})
