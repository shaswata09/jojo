/**
 * "From link", end to end as wiring (D20: the dialog and the form's writes
 * are hooks and JSX, so they are read as source).
 *
 * Q131 — the agent reads the pasted URL, saves the page and prefills the
 *        application form.
 * Q232 — the page is saved filed under that posting's application.
 * Q094 — the page is stored WITH the application it was added to.
 *
 * The read and the keep are `posting-agent.requests.test.ts`. This holds the
 * two hand-offs after it: the read's draft and kept page go into the create
 * form, and Save files that page under the record it creates — inside the same
 * Undo, so undoing the application does not leave the page filed under nothing.
 */
import { describe, expect, it } from 'vitest'
import dialog from './AddFromLinkDialog.tsx?raw'
import writes from './dialog/use-application-writes.ts?raw'

const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q131/Q232 the read posting prefills the create form', () => {
  it('opens the create form from the model’s draft, carrying the kept page', () => {
    const src = code(dialog)
    expect(src).toMatch(/const outcome = await readPosting\(\{\s*url: text,\s*settings,\s*reader,/)
    expect(src).toMatch(
      /openDialog\('application', \{\s*mode: 'create',\s*initial: \{\s*\.\.\.outcome\.draft,[\s\S]{0,200}?postingFileId: outcome\.file\.id,\s*\},\s*\}\)/,
    )
  })
})

describe('Q094/Q232 Save files the kept page under the new application', () => {
  const src = code(writes)

  it('takes the page the form was started from', () => {
    expect(src).toMatch(/const postingId = initial\?\.postingFileId/)
  })

  it('adds the new record to the page’s filing, inside the create’s Undo', () => {
    const create = src.indexOf('function create(): SaveOutcome {')
    const undo = src.indexOf('undoable(() => {', create)
    const filing = src.indexOf(
      'vault.updateFile(posting.id, {\n          applicationIds: [...new Set([...posting.applicationIds, record.id])],',
      create,
    )
    const closed = src.indexOf('if (created === null)', create)
    expect(create).toBeGreaterThan(-1)
    expect(undo).toBeGreaterThan(create)
    expect(filing).toBeGreaterThan(undo)
    expect(closed).toBeGreaterThan(filing)
  })
})
