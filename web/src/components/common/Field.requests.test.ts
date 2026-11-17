import { describe, expect, it } from 'vitest'
import fieldSource from './Field.tsx?raw'
import localModelSource from '../settings/LocalModelPanel.tsx?raw'

/**
 * Owner request Q170: an API key field has an eye button that shows or hides
 * the key. D20 leaves no way to press it, so the decision is read off source:
 * every `type="password"` Field gets the toggle, it flips the input to text,
 * starts hidden, and is labelled by what pressing it does.
 */
describe('Q170 — revealing a secret field', () => {
  it('turns a password field into text only while shown', () => {
    expect(fieldSource).toContain("const secret = props.type === 'password'")
    expect(fieldSource).toContain('const [shown, setShown] = useState(false)')
    expect(fieldSource).toContain("const type = secret && shown ? 'text' : props.type")
    // Spread BEFORE `type`, or the caller's "password" would win back.
    expect(fieldSource).toMatch(/\{\.\.\.props\}\s*type=\{type\}/)
  })

  it('draws an eye button that toggles it, named for what it does', () => {
    const button = /\{secret \? \([\s\S]*?<\/button>/.exec(fieldSource)?.[0] ?? ''
    expect(button).toContain('setShown((was) => !was)')
    expect(button).toContain(
      "aria-label={shown ? t('field.hide', { label }) : t('field.show', { label })}",
    )
    expect(button).toMatch(/<EyeOff\b[\s\S]*<Eye\b/)
  })

  it('is what the model settings use for the API key', () => {
    expect(localModelSource).toMatch(
      /label=\{t\('model\.apiKey\.label'\)\}[\s\S]{0,80}type="password"/,
    )
  })
})
