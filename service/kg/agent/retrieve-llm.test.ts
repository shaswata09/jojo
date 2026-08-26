/**
 * The chooser, and the ways it is allowed to be wrong.
 *
 * It stands between a request and the tools an assistant may use, so its
 * failure modes are asymmetric. Picking a spare tool costs a little context.
 * Picking none, or picking `memory.clear`, costs the request or the store — so
 * every path that could produce either is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { listing, pickTools, readPicks, retrieverMessages } from './retrieve-llm'
import { NEVER_IMPLICIT } from './retrieve'
import type { Turn } from '../core/model-server'

const answering = (text: string) => async (): Promise<Turn> => ({
  ok: true,
  text,
  toolCalls: [],
  finishReason: 'stop',
})

describe('the listing', () => {
  it('is names and one line each, never schemas', () => {
    const text = listing()
    expect(text.split('\n')).toHaveLength(CATALOG.length)
    // The whole economic argument: choosing must cost a fraction of offering.
    // Full schemas are about 16,000 tokens; this must stay far under that.
    expect(Math.round(text.length / 3.6)).toBeLessThan(5_000)
  })

  it('cuts a paragraph down to its first sentence', () => {
    // Several summaries run long — the longest is 859 characters — and a
    // chooser reading ninety-two paragraphs pays for prose it cannot use.
    for (const line of listing().split('\n')) expect(line.length).toBeLessThan(200)
  })

  it('names every tool, so nothing is unpickable', () => {
    const text = listing()
    for (const entry of CATALOG) expect(text).toContain(entry.name)
  })
})

describe('readPicks', () => {
  it('reads a clean answer', () => {
    expect(readPicks('{"tools":["memory.list","application.create"]}')).toEqual([
      'memory.list',
      'application.create',
    ])
  })

  it('reads it through the wrapping models add', () => {
    expect(readPicks('Here you go:\n```json\n{"tools":["memory.list"]}\n```')).toEqual([
      'memory.list',
    ])
  })

  it('accepts the underscore spelling, which is what the wire uses', () => {
    const entry = CATALOG.find((e) => e.wireName !== e.name)
    expect(entry).toBeDefined()
    if (!entry) return
    expect(readPicks(`{"tools":["${entry.wireName}"]}`)).toEqual([entry.name])
  })

  it('drops an invented name rather than failing the whole reply', () => {
    // Nine real picks and one hallucination is still a useful answer.
    expect(readPicks('{"tools":["memory.list","memory.teleport"]}')).toEqual(['memory.list'])
  })

  it('de-duplicates', () => {
    expect(readPicks('{"tools":["memory.list","memory.list"]}')).toEqual(['memory.list'])
  })

  it('returns null — not an empty list — for every kind of nothing', () => {
    // `null` and `[]` take different branches in the caller: null falls back to
    // the lexicon, and an empty pick would leave the assistant with no tools.
    expect(readPicks('I think you should use memory.list')).toBeNull()
    expect(readPicks('{"tools":[]}')).toBeNull()
    expect(readPicks('{"tools":"memory.list"}')).toBeNull()
    expect(readPicks('')).toBeNull()
    expect(readPicks('{"tools":["nothing.real"]}')).toBeNull()
  })
})

describe('retrieverMessages', () => {
  it('carries the request and the catalog, and no conversation', () => {
    const [system, user] = retrieverMessages('move Rice to interview')
    expect(system?.content).toContain('JSON only')
    expect(user?.content).toContain('move Rice to interview')
    expect(user?.content).toContain('memory.list')
  })

  it('includes recent lines when there are any, so a follow-up is readable', () => {
    // "and the second one?" is unreadable alone and obvious with one line.
    const [, user] = retrieverMessages('and the second one?', ['I found two Rice applications.'])
    expect(user?.content).toContain('two Rice applications')
  })

  it('says nothing about recency when there is none', () => {
    const [, user] = retrieverMessages('hello')
    expect(user?.content).not.toContain('Recently said')
  })
})

describe('pickTools', () => {
  it('returns the picks when the chooser answers', async () => {
    const out = await pickTools({ ask: answering('{"tools":["memory.list"]}') }, 'what do I have?')
    expect(out).toEqual(['memory.list'])
  })

  it('returns null when the chooser is unreachable, refuses, or rambles', async () => {
    // Every one of these means "fall back to the lexicon", which is offline and
    // cannot fail — so a chooser that is down costs latency, never capability.
    const thrown = await pickTools({
      ask: () => Promise.reject(new Error('ECONNREFUSED')),
    }, 'x')
    expect(thrown).toBeNull()

    const refused = await pickTools({
      ask: async (): Promise<Turn> => ({ ok: false, kind: 'refused', reason: '429' }),
    }, 'x')
    expect(refused).toBeNull()

    expect(await pickTools({ ask: answering('sure, use the list tool') }, 'x')).toBeNull()
  })

  it('cannot hand back a tool that is never offered implicitly', async () => {
    // The chooser is a model, and a model asked to be generous will reach for
    // whatever sounds useful. `memory.clear` must not be reachable this way —
    // the caller strips it, and this pins that the chooser cannot pre-empt that
    // by returning it as a plain pick the caller trusts.
    const out = await pickTools(
      { ask: answering(`{"tools":${JSON.stringify(NEVER_IMPLICIT)}}`) },
      'tidy up my records',
    )
    // It parses — the names are real — and the CALLER is what refuses them.
    // This test exists so that if `readPicks` ever starts filtering, the two
    // places do not silently disagree about whose job it is.
    expect(out).toEqual([...NEVER_IMPLICIT])
  })
})
