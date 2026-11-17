/**
 * Q298: a suggested value prefilled as a placeholder in the profile's
 * background forms looked like data the person had already entered. Every text
 * field's placeholder is now set apart — its own colour token, in italics.
 *
 * The forms take `Input` and `Textarea` from here, so the decision lives in
 * their class lists and in the token (D20: a narrow source read).
 */

import { describe, expect, it } from 'vitest'
import input from './input.tsx?raw'
import textarea from './textarea.tsx?raw'
import field from '@/components/common/Field.tsx?raw'
import background from '@/components/profile/BackgroundPanel.tsx?raw'
import profileCatalog from '@/i18n/locales/en/profile.json'
import indexCss from '@/index.css?raw'

/** Every value one custom property is given in the stylesheet, in order. */
const valuesOf = (name: string) =>
  [...indexCss.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'gm'))].map((m) => m[1]?.trim())

describe('Q298 — placeholders read as placeholders, not as entered values', () => {
  it.each([
    ['Input', input],
    ['Textarea', textarea],
  ])('%s draws its placeholder in the placeholder colour, in italics', (_name, source) => {
    expect(source).toMatch(/\bplaceholder:text-text-placeholder\b/)
    expect(source).toMatch(/\bplaceholder:italic\b/)
  })

  it('gives the placeholder a colour of its own in both themes, not the value colour', () => {
    const placeholder = valuesOf('--text-placeholder')
    const value = valuesOf('--text-1')
    expect(placeholder.length).toBeGreaterThanOrEqual(2)
    for (const colour of placeholder) expect(value).not.toContain(colour)
    expect(indexCss).toMatch(/--color-text-placeholder: var\(--text-placeholder\);/)
  })

  it('is what the background forms are built from', () => {
    expect(background).toMatch(/import \{ Field, TextareaField \} from '@\/components\/common\/Field'/)
    expect(field).toContain("import { Input } from '@/components/ui/input'")
    expect(field).toContain("import { Textarea } from '@/components/ui/textarea'")
    expect(background).toMatch(/placeholder=\{t\('background\.form\.whenPlaceholder'\)\}/)
    expect(profileCatalog.background.form.whenPlaceholder).toBe('As written — “2021–2024”')
  })
})
