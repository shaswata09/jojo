/**
 * Q267 — a colour picked off the spectrum for a keyword persists, and comes
 * back the same after a reload.
 *
 * Every stored node is read back through `propSchemaFor(type)` (see
 * `validateNode`), on boot and on restore, so this is the gate a custom keyword
 * colour has to pass to survive. Before the picker the keyword schema had no
 * place for it: the eight named tones were all a keyword could keep.
 */
import { describe, expect, it } from 'vitest'
import { propSchemaFor } from './validate-props'

const keyword = (props: Record<string, unknown>) =>
  propSchemaFor('keyword').parse({ slug: 'ml', name: 'Machine learning', tone: 'teal', ...props }, '')

describe('a keyword’s custom colour (Q267)', () => {
  it('is kept, for any colour on the spectrum and not only the presets', () => {
    for (const hex of ['#7c3aed', '#ff6600', '#123456', '#ffffff', '#000000']) {
      const read = keyword({ ink: hex })
      expect(read.ok, hex).toBe(true)
      expect((read as { value: { ink?: string } }).value.ink).toBe(hex)
    }
  })

  it('is kept in one spelling, so it renders the same after a reload', () => {
    const read = keyword({ ink: '#7C3AED' })
    expect((read as { value: { ink?: string } }).value.ink).toBe('#7c3aed')
    const short = keyword({ ink: '#fa0' })
    expect((short as { value: { ink?: string } }).value.ink).toBe('#ffaa00')
  })

  it('keeps the preset tone beside it as the fallback', () => {
    const read = keyword({ ink: '#123456' })
    expect((read as { value: { tone: string } }).value.tone).toBe('teal')
  })

  it('refuses something that is not a colour, rather than storing it', () => {
    expect(keyword({ ink: 'url(evil)' }).ok).toBe(false)
    expect(keyword({ ink: 'red' }).ok).toBe(false)
  })
})
