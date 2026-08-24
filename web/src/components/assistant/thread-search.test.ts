/**
 * Chat search, which is mostly an index-arithmetic problem wearing a UI.
 *
 * The cases that matter are the accented ones. This app folds text before
 * comparing it, folding changes the length of the string, and every offset this
 * module returns is used to SLICE the original — so an off-by-one from a
 * decomposed character does not fail loudly, it highlights the wrong letters
 * and nobody files it. Half of what is below exists to pin that.
 *
 * Nothing here mounts a component: D20 rules out jsdom, which is the whole
 * reason the arithmetic lives in a module rather than in the JSX.
 */

import { describe, expect, it } from 'vitest'
import type { Thread } from '@jojo/service/react/use-threads'
import type { NodeId } from '@jojo/service/core/model'
import {
  findMatches,
  searchThreads,
  snippetAround,
  splitOnMatches,
} from './thread-search'

/** The matched substrings, sliced back out of the original — the real contract. */
const hits = (text: string, query: string) =>
  findMatches(text, query).map((m) => text.slice(m.start, m.end))

describe('findMatches', () => {
  it('finds every occurrence, left to right', () => {
    expect(hits('salary, salary, salary', 'salary')).toEqual(['salary', 'salary', 'salary'])
    expect(findMatches('salary, salary', 'salary')).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 14 },
    ])
  })

  it('ignores case, the way every other filter in this app does', () => {
    expect(hits('Nine-month SALARY', 'salary')).toEqual(['SALARY'])
    expect(hits('nine-month salary', 'SALARY')).toEqual(['salary'])
  })

  it('slices the ORIGINAL text when accents shifted the folded offsets', () => {
    /*
     * The bug this module is shaped around. 'André' folds to 'andre', which is
     * the same length — but 'é' NFD-decomposes to 'e' + a combining mark and the
     * mark is deleted, so any match AFTER an accent sits at a different offset
     * in the folded string than in the original. Slicing by the folded offset
     * silently returns neighbouring characters.
     */
    expect(hits('André said salary', 'salary')).toEqual(['salary'])
    expect(hits('Muñoz mentioned the salary twice', 'salary')).toEqual(['salary'])
    // Several accents before the match, so the drift would be several characters.
    expect(hits('André, Renée and Zoë discussed salary', 'salary')).toEqual(['salary'])
    // And the accented word itself is findable without the accent.
    expect(hits('André said so', 'andre')).toEqual(['André'])
    expect(hits('Muñoz', 'munoz')).toEqual(['Muñoz'])
  })

  it('handles a match at the very end of the string', () => {
    expect(hits('the salary', 'salary')).toEqual(['salary'])
    expect(findMatches('the salary', 'salary')).toEqual([{ start: 4, end: 10 }])
  })

  it('does not fall over on an emoji before the match', () => {
    // A pasted job advert can carry one, and a surrogate pair is two UTF-16
    // units for one character — the exact thing a naive index walk gets wrong.
    expect(hits('🎯 the salary', 'salary')).toEqual(['salary'])
  })

  it('matches a query with a space in it', () => {
    /*
     * `fold` starts with `.trim()`, so folding one character at a time turned
     * every space into nothing and "the salary" became "thesalary". Every
     * multi-word search failed and every single-word test still passed, which
     * is why this case is written out rather than assumed.
     */
    expect(hits('ask about the salary today', 'the salary')).toEqual(['the salary'])
    expect(hits('nine month salary', 'month salary')).toEqual(['month salary'])
    expect(hits('André said the salary', 'the salary')).toEqual(['the salary'])
    // And a phrase that is not there stays not there.
    expect(hits('the salary', 'the wage')).toEqual([])
  })

  it('returns nothing for an empty or whitespace query rather than everything', () => {
    // `matchesQuery` treats an empty needle as "matches" because it is a filter
    // predicate. This is a highlighter: an empty query must highlight NOTHING,
    // or every character in the transcript lights up the moment the box is
    // focused and emptied.
    expect(findMatches('salary', '')).toEqual([])
    expect(findMatches('salary', '   ')).toEqual([])
    expect(findMatches('', 'salary')).toEqual([])
  })

  it('does not overlap, so the count agrees with the marks', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })
})

describe('snippetAround', () => {
  const long = `${'x'.repeat(200)} the nine-month salary is confirmed ${'y'.repeat(200)}`

  it('returns a readable window around the first match', () => {
    const s = snippetAround(long, 'salary')
    expect(s).not.toBeNull()
    expect(s?.text).toContain('salary')
    expect(s?.text.length).toBeLessThan(long.length)
    expect(s?.clippedStart).toBe(true)
    expect(s?.clippedEnd).toBe(true)
  })

  it('reports match offsets relative to the snippet, not the original', () => {
    const s = snippetAround(long, 'salary')
    expect(s).not.toBeNull()
    if (s) {
      const first = s.matches[0]
      expect(first).toBeDefined()
      if (first) expect(s.text.slice(first.start, first.end).toLowerCase()).toBe('salary')
    }
  })

  it('does not claim to be clipped when the whole text fits', () => {
    const s = snippetAround('the salary', 'salary')
    expect(s?.clippedStart).toBe(false)
    expect(s?.clippedEnd).toBe(false)
    expect(s?.text).toBe('the salary')
  })

  it('is null when there is nothing to show', () => {
    expect(snippetAround('nothing here', 'salary')).toBeNull()
    expect(snippetAround('', 'salary')).toBeNull()
  })
})

describe('splitOnMatches', () => {
  it('splits into alternating runs that rejoin to the original', () => {
    const text = 'the salary and the salary'
    const parts = splitOnMatches(text, findMatches(text, 'salary'))
    expect(parts.map((p) => p.text).join('')).toBe(text)
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['salary', 'salary'])
  })

  it('handles a match at the start and at the end', () => {
    const parts = splitOnMatches('salary', findMatches('salary', 'salary'))
    expect(parts).toEqual([{ text: 'salary', hit: true }])
  })

  it('returns one plain run when there is nothing to mark', () => {
    expect(splitOnMatches('nothing', [])).toEqual([{ text: 'nothing', hit: false }])
    expect(splitOnMatches('', [])).toEqual([])
  })
})

/* --------------------------------- threads -------------------------------- */

let seq = 0
const thread = (title: string, texts: string[], applicationId: NodeId | null = null): Thread => {
  seq += 1
  return {
    id: `thread:${String(seq)}` as NodeId,
    title,
    entries: texts.map((text, i) => ({
      id: `e${String(i)}`,
      kind: i % 2 === 0 ? ('you' as const) : ('answer' as const),
      text,
    })),
    applicationId,
    autoApprove: false,
    updatedAt: '2026-08-24T10:00:00.000Z',
  } as Thread
}

describe('searchThreads', () => {
  const threads = [
    thread('What should I ask Rice about', [
      'What should I ask Rice about',
      'Ask about the nine-month salary and whether summer funding is separate.',
    ]),
    thread('Cover letter for Stripe', [
      'Cover letter for Stripe',
      'Here is a draft that mentions your teaching.',
    ]),
    thread('Salary in the title', ['unrelated body text']),
  ]
  const nameOf = () => ''

  it('searches BOTH sides of the conversation, and the notes and errors too', () => {
    /*
     * The point of the feature, pinned per entry kind rather than assumed.
     * `you` is what the person typed and `answer` is what the model replied;
     * a search that read only one of them would answer half the question and
     * look like it worked. `note` (narration while it works) and `error` carry
     * text a reader may well be hunting for — "why did that fail" — so they are
     * searched as well. Only `step` is different, and it has its own case.
     */
    const mixed = {
      ...thread('Untitled', []),
      entries: [
        { kind: 'you' as const, text: 'zebra question from the person' },
        { kind: 'answer' as const, text: 'giraffe reply from the model' },
        { kind: 'note' as const, text: 'okapi narration while working' },
        { kind: 'error' as const, text: 'tapir went wrong' },
      ],
    } as unknown as Thread

    for (const word of ['zebra', 'giraffe', 'okapi', 'tapir']) {
      expect(searchThreads([mixed], word, nameOf), word).toHaveLength(1)
    }
    expect(searchThreads([mixed], 'wildebeest', nameOf)).toHaveLength(0)
  })

  it('finds a conversation by what was SAID, not only by its title', () => {
    // The whole point. "salary" appears in the body of the first thread and in
    // the title of the third; the old filter could only ever see the third.
    const found = searchThreads(threads, 'salary', nameOf)
    expect(found.map((h) => h.thread.title)).toEqual([
      'What should I ask Rice about',
      'Salary in the title',
    ])
  })

  it('shows why it matched, when the reason is not in the title', () => {
    const [rice] = searchThreads(threads, 'salary', nameOf)
    expect(rice?.inTitle).toBe(false)
    expect(rice?.snippet?.text).toContain('salary')
  })

  it('counts every hit across the title and the turns', () => {
    const t = thread('salary', ['salary here', 'and salary again'])
    const [hit] = searchThreads([t], 'salary', nameOf)
    expect(hit?.matchCount).toBe(3)
  })

  it('keeps the order it was given rather than sorting by relevance', () => {
    // A list that reorders itself as you type is a list you cannot click.
    const found = searchThreads(threads, 'e', nameOf)
    const givenOrder = threads.filter((t) => found.some((h) => h.thread.id === t.id))
    expect(found.map((h) => h.thread.id)).toEqual(givenOrder.map((t) => t.id))
  })

  it('still matches the application it is filed under', () => {
    // The behaviour the old filter had. Adding body search must not remove it.
    const found = searchThreads([threads[1]!], 'rice', () => 'Rice University')
    expect(found).toHaveLength(1)
    expect(found[0]?.inName).toBe(true)
  })

  it('returns nothing for an empty query, so the list is not filtered by a blank box', () => {
    expect(searchThreads(threads, '', nameOf)).toEqual([])
    expect(searchThreads(threads, '  ', nameOf)).toEqual([])
  })

  it('searches a tool step by what it was called, not by its raw arguments', () => {
    const withStep = {
      ...thread('Tool run', ['find the offer']),
      entries: [
        { kind: 'you' as const, text: 'find the offer' },
        {
          kind: 'step' as const,
          tool: 'application.offer.decide',
          title: 'Set the offer deadline',
          effect: 'update',
          args: { secretKeyName: 'should not be searchable' },
          status: 'done' as const,
          detail: 'Respond by 2026-09-30',
        },
      ],
    } as unknown as Thread

    expect(searchThreads([withStep], 'offer deadline', nameOf)).toHaveLength(1)
    expect(searchThreads([withStep], 'application.offer.decide', nameOf)).toHaveLength(1)
    expect(searchThreads([withStep], '2026-09-30', nameOf)).toHaveLength(1)
    // The arguments are JSON; matching a key name in them would be matching
    // machinery rather than anything anybody said.
    expect(searchThreads([withStep], 'secretKeyName', nameOf)).toHaveLength(0)
  })
})
