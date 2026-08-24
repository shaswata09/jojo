import { fold } from '@jojo/service/core/text'
import type { Thread } from '@jojo/service/react/use-threads'
import type { ThreadEntry } from '@jojo/service/core/model'

/**
 * Searching what was actually said, not just what the conversation is called.
 *
 * `ThreadList` already had a filter and it matched two fields: the thread title
 * and the name of the application it is filed under. That answers "which
 * conversation is about Rice" and nothing else. The question a person actually
 * arrives with is the other one — "where did it tell me the salary was
 * nine-month" — and the title, which is the first sentence they happened to
 * type, almost never contains it.
 *
 * Everything needed is already in memory: `useThreads()` returns every thread
 * with its full `entries` array, so this is a scan over data the page is
 * holding anyway rather than a store query.
 *
 * WHY THE INDEX MAPPING, which is the only hard part here. The app folds text
 * before comparing it — `core/text.ts` lowercases and strips accents so that
 * typing "Andre" finds "André" — and `fold` uses `normalize('NFD')`, which
 * DECOMPOSES a character into a base plus a combining mark and then deletes the
 * mark. So folding changes the length of the string. Searching the folded text
 * gives an offset that does not point at the same place in the original, and
 * highlighting by that offset puts the marker one character further left for
 * every accent that came before it. `foldWithMap` folds one character at a time
 * and records where each folded character came from, so every offset this
 * module returns is an index into the ORIGINAL text and can be sliced with.
 */

/** A hit, as a half-open range of the ORIGINAL text. */
export type Match = { start: number; end: number }

/**
 * The folded text, plus where each of its characters came from.
 *
 * One entry per folded character, holding the index in `text` it was produced
 * from. A character that folds to nothing (a lone combining accent) contributes
 * no entry; one that folds to several contributes several, all pointing at the
 * same original index — which is what makes the mapping safe to use as a slice
 * boundary in both directions.
 */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  // Iterated by code point, so an astral character — an emoji pasted out of a
  // job advert — is one character here rather than a surrogate half that folds
  // to nonsense.
  let index = 0
  for (const char of text) {
    /*
     * Whitespace is passed through rather than folded, and this is not a
     * nicety. `fold` begins with `.trim()`, which is right for its real job —
     * comparing one whole field against one whole query — and wrong applied to
     * a single character: `fold(' ')` is the empty string, so a per-character
     * walk silently deletes every space. "the salary" folded to "thesalary" and
     * no multi-word query could ever match. Caught by a test, not by reading.
     */
    const piece = /\s/.test(char) ? char : fold(char)
    // One map entry per UTF-16 UNIT, not per code point: `folded` grows by
    // units, and an emoji that added two units while pushing one entry put
    // every offset after it out by one.
    for (let i = 0; i < piece.length; i += 1) map.push(index)
    folded += piece
    index += char.length
  }
  return { folded, map }
}

/**
 * Every occurrence of `query` in `text`, in original-string coordinates.
 *
 * Non-overlapping and left to right, which is what a "3 matches" count has to
 * mean for the number beside a row to agree with the marks inside it.
 */
export function findMatches(text: string, query: string): Match[] {
  const needle = fold(query)
  if (!needle || !text) return []

  const { folded, map } = foldWithMap(text)
  const out: Match[] = []
  let from = 0

  for (;;) {
    const at = folded.indexOf(needle, from)
    if (at === -1) break
    const start = map[at]
    // The end is the original index just past the last matched character, so a
    // match that ends at the end of the string slices correctly.
    const lastFolded = at + needle.length - 1
    const lastOriginal = map[lastFolded]
    if (start === undefined || lastOriginal === undefined) break
    // Step past the whole original character, not one unit — the last folded
    // character may have come from a surrogate pair.
    const end = lastOriginal + [...text.slice(lastOriginal)][0]!.length
    out.push({ start, end })
    from = at + needle.length
  }

  return out
}

/** How much of the surrounding sentence a snippet keeps on each side. */
const RADIUS = 48

export type Snippet = {
  /** A slice of the original text, wide enough to read the match in context. */
  text: string
  /** Hits inside `text`, so the caller does not search the slice again. */
  matches: Match[]
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * The first match with enough either side of it to be a sentence.
 *
 * Returns the slice rather than a pre-formatted string with ellipses in it: the
 * caller has to wrap the hits in a mark, and a string with "…" already glued on
 * would have to be re-parsed to find them again.
 */
export function snippetAround(text: string, query: string, radius = RADIUS): Snippet | null {
  const all = findMatches(text, query)
  const first = all[0]
  if (!first) return null

  // Snap to a space where there is one nearby, so a snippet starts at a word.
  const rawStart = Math.max(0, first.start - radius)
  const rawEnd = Math.min(text.length, first.end + radius)
  const spaceAt = text.indexOf(' ', rawStart)
  const start = rawStart > 0 && spaceAt !== -1 && spaceAt < first.start ? spaceAt + 1 : rawStart
  const spaceBefore = text.lastIndexOf(' ', rawEnd)
  const end = rawEnd < text.length && spaceBefore > first.end ? spaceBefore : rawEnd

  const slice = text.slice(start, end)
  return {
    text: slice,
    matches: all
      .filter((m) => m.start >= start && m.end <= end)
      .map((m) => ({ start: m.start - start, end: m.end - start })),
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  }
}

/**
 * Splits text into runs, flagging which are hits.
 *
 * Exists so the component renders `parts.map(...)` instead of doing index
 * arithmetic in JSX, and so the arithmetic is somewhere a test can reach —
 * nothing in this app mounts a component in a test (D20), which is exactly why
 * every rule worth checking lives in a module like this one.
 */
export function splitOnMatches(
  text: string,
  matches: readonly Match[],
): { text: string; hit: boolean }[] {
  if (matches.length === 0) return text ? [{ text, hit: false }] : []
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const m of matches) {
    if (m.start > at) out.push({ text: text.slice(at, m.start), hit: false })
    out.push({ text: text.slice(m.start, m.end), hit: true })
    at = m.end
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

/**
 * The searchable text of one turn.
 *
 * A step is not prose — it is a tool run — so what is searchable about it is
 * what it was CALLED and what it reported: "Set the offer deadline" and the
 * detail line under it. The raw arguments are deliberately left out; they are
 * JSON, and a query would match a key name rather than anything the person
 * said.
 */
export function entryText(entry: ThreadEntry): string {
  if (entry.kind === 'step') {
    return [entry.title, entry.tool, entry.detail].filter(Boolean).join(' ')
  }
  return entry.text
}

export type ThreadHit = {
  thread: Thread
  /** Total hits across the title and every turn — what the count beside a row shows. */
  matchCount: number
  /** Why it matched, when the reason is not visible in the title. */
  snippet: Snippet | null
  inTitle: boolean
  inName: boolean
}

/**
 * Every conversation that mentions the query, with the evidence.
 *
 * Order is the caller's — `useThreads` sorts newest first and `ThreadList`
 * regroups by job — so this deliberately does not re-sort by relevance. A list
 * that reorders itself as you type is a list you cannot click.
 */
export function searchThreads(
  threads: readonly Thread[],
  query: string,
  nameOf: (thread: Thread) => string,
): ThreadHit[] {
  if (!fold(query)) return []

  const hits: ThreadHit[] = []
  for (const thread of threads) {
    const name = nameOf(thread)
    const inTitle = findMatches(thread.title, query).length > 0
    const inName = findMatches(name, query).length > 0

    let matchCount = findMatches(thread.title, query).length
    let snippet: Snippet | null = null
    for (const entry of thread.entries) {
      const text = entryText(entry)
      if (!text) continue
      const found = findMatches(text, query)
      matchCount += found.length
      // The first turn that mentions it, which is the one worth showing: a
      // later one is usually the assistant repeating the question back.
      if (!snippet && found.length > 0) snippet = snippetAround(text, query)
    }

    if (matchCount > 0 || inName) hits.push({ thread, matchCount, snippet, inTitle, inName })
  }
  return hits
}
