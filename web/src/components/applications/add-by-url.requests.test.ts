/**
 * Q131 — with a model connected, pasting a link and pressing the button beside
 * it starts "From link": the model reads the page and fills the form. Without
 * one, the address is turned into a guess and the plain create form opens.
 * `addByUrlDialog` is the choice `AddByUrl` makes, lifted out unchanged; the
 * phone's paste row makes the same one (`ApplicationsScreen`'s `PasteUrlRow`).
 */
import { describe, expect, it } from 'vitest'
import { addByUrlDialog } from './add-by-url'

describe('Q131 what the paste-a-link button opens', () => {
  it('starts the From link read on the pasted address when a model is connected', () => {
    expect(addByUrlDialog('  https://jobs.rice.edu/postings/29411 ', true)).toEqual({
      name: 'applicationFromLink',
      props: { url: 'https://jobs.rice.edu/postings/29411', start: true },
    })
  })

  it('opens the create form with a guess from the address when none is', () => {
    const opened = addByUrlDialog('boards.greenhouse.io/acme/jobs/4', false)
    expect(opened?.name).toBe('application')
    expect(opened?.props.mode).toBe('create')
    const initial = opened?.props.initial as { url?: string } | undefined
    expect(initial?.url).toContain('boards.greenhouse.io/acme/jobs/4')
  })

  it('opens nothing for an empty field', () => {
    expect(addByUrlDialog('   ', true)).toBeNull()
  })
})
