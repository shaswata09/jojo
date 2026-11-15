/**
 * Owner requests about the board card: the drag handle is a full-height rail
 * down the left edge with the text starting at the top (Q240), and the card
 * carries no application note (Q260).
 *
 * Both are JSX-only decisions, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import card from './BoardCard.tsx?raw'

/** The class list of the drag handle — the `<button>` carrying the drag listeners. */
function handleClasses(): string {
  const button = /<button\b[\s\S]*?\{\.\.\.handle\?\.listeners\}/.exec(card)?.[0] ?? ''
  // The first quoted class string inside `cn(...)`, past the comments around it.
  return /'(touch-target[^']*)'/.exec(button)?.[1] ?? ''
}

describe('Q240 — the card drag handle is a full-height bar on the left', () => {
  it('pins the handle to the whole left edge, top to bottom', () => {
    const classes = handleClasses().split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['absolute', 'inset-y-0', 'left-0', 'cursor-grab']))
  })

  it('draws its grip dots down the whole height of the bar', () => {
    expect(card).toMatch(/<span\s+className="mx-auto block h-full w-2 bg-\[radial-gradient/)
  })

  it('leaves the rail a gutter and starts the card text at the top', () => {
    expect(card).toMatch(/'surface group relative rounded-md py-2\.5 pr-2\.5 pl-5'/)
    expect(card).toContain('<div className="flex items-start gap-2">')
  })
})

describe('Q260 — board cards do not show application notes', () => {
  it('never reads the note off the record it draws', () => {
    expect(card).toContain('export function BoardCardBody')
    expect(card).not.toMatch(/\bapp\.note\b/)
    expect(card).not.toMatch(/\{\s*note\s*\}/)
  })
})
