/**
 * Review finding web-2: typing a stage date with the keyboard was impossible.
 * The first year digit reported '0002-09-14', the write was refused, and the
 * field — bound straight to the stored date — was reset, wiping the month and
 * day. The draft logic is `isWholeDate` (`lib/date-draft.test.ts`); what only
 * exists in the JSX is that the field is wired to it.
 */

import { describe, expect, it } from 'vitest'
import source from './StageDatesPanel.tsx?raw'

const input = /function StageDateInput\([\s\S]*$/.exec(source)?.[0] ?? ''

describe('a stage date typed with the keyboard (web-2)', () => {
  it('holds what is typed as a draft, not the stored date', () => {
    expect(source).toMatch(/<StageDateInput\s+stored=\{on\}/)
    expect(input).toContain('value={draft}')
    expect(input).not.toMatch(/value=\{stored/)
  })

  it('writes as you go only once the date is whole', () => {
    expect(input).toMatch(/setDraft\(typed\)\s*if \(isWholeDate\(typed\)\) onCommit\(typed\)/)
  })

  it('commits the rest on Enter or leaving the field, an emptied field included', () => {
    expect(input).toContain('onBlur={(event) => settle(event.currentTarget)}')
    expect(input).toMatch(/if \(event\.key === 'Enter'\) settle\(event\.currentTarget\)/)
    // A half-filled date input also reads as '', and only `badInput` tells the
    // two apart — clearing a stage's date on a half-typed one would lose it.
    expect(input).toMatch(
      /typed === '' \? !input\.validity\.badInput : isWholeDate\(typed\)\) onCommit\(typed\)/,
    )
  })
})
