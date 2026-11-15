/**
 * Q131 — "+New adds 'application from link' when an LLM agent is connected."
 *
 * `offeredCreateActions` is the gate `useCreateActions` applies to the one
 * array both the + menu and the command palette render. The row has to be
 * there with a model and gone without one — a row whose dialog can only say
 * "set a model up first" wastes the click.
 */
import { describe, expect, it } from 'vitest'
import { CREATE_ACTIONS, offeredCreateActions } from './create-actions'

const fromLink = (rows: readonly { id: string }[]) =>
  rows.find((row) => row.id === 'new-application-from-link')

describe('Q131 the + menu offers an application from a link', () => {
  it('offers it, opening the From link dialog, when a model is connected', () => {
    const row = offeredCreateActions(CREATE_ACTIONS, true).find(
      (r) => r.id === 'new-application-from-link',
    )
    expect(row?.label).toBe('Application from a link')
    expect(row?.dialog?.name).toBe('applicationFromLink')
  })

  it('leaves it out without a model, and keeps the plain New application', () => {
    const rows = offeredCreateActions(CREATE_ACTIONS, false)
    expect(fromLink(rows)).toBeUndefined()
    expect(rows.some((r) => r.id === 'new-application')).toBe(true)
  })
})
