/**
 * The ledger checker reads a cited title as a TEST title, not as any text in
 * the file (review 3, coverage-10). `GlancePanel.requests.test.ts`'s header
 * comment says "the glance stats are four small tiles", so Q006's "are four"
 * stayed green with `it('are four', …)` deleted while the checker only asked
 * whether the file contained the words.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a plain .mjs script with no declaration file.
import { testTitles } from '../scripts/test-titles.mjs'

const titlesIn = (text: string): string[] => testTitles(text) as string[]

describe('the titles check-requests accepts', () => {
  it('reads it, test and describe titles, with each and other modifiers between', () => {
    const text = [
      "describe('a suite (Q006)', () => {",
      "  it('are four', () => {})",
      '  test("double quoted", () => {})',
      "  it.each([['a', 1], ['b', 2]])('shows %s', (x) => {})",
      '  it.concurrent(`a template ${"title"}`, () => {})',
      "  describe.each(['x'])('per %s', () => {})",
      '})',
    ].join('\n')
    expect(titlesIn(text)).toEqual([
      'a suite (Q006)',
      'are four',
      'double quoted',
      'shows %s',
      'a template ${"title"}',
      'per %s',
    ])
  })

  it('does not take a comment, a plain string or a regex for a title', () => {
    const text = [
      '/** the glance stats are four small tiles */',
      "// it('commented out', () => {})",
      "const note = 'not a test'",
      "const re = /it\\('in a regex'/",
      "if (re.test('member call')) expect.it('nope')",
    ].join('\n')
    expect(titlesIn(text)).toEqual([])
  })

  it('does not count a skipped or todo test as a guard', () => {
    const text = [
      "it.skip('skipped', () => {})",
      "it.todo('to do')",
      "it.skipIf(true)('skipped if', () => {})",
      "it.runIf(true)('run if', () => {})",
    ].join('\n')
    expect(titlesIn(text)).toEqual(['run if'])
  })
})
