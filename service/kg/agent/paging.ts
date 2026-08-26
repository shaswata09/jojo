/**
 * Reading a document that does not fit in one window. L2 agent, no dependencies.
 *
 * ## Why this is its own file
 *
 * It began beside the MarkItDown client, which is where it is used, and that
 * import turned out to close a circle: `catalog` reads the tool list from
 * `queries`, `queries` needed to page a document, `markitdown` speaks MCP, and
 * `mcp` publishes the catalog. Node evaluated `catalog` with `queries` still
 * half-built and `Object.values(READS)` threw on undefined — a runtime failure
 * that `tsc` cannot see, because the types in a cycle are all perfectly valid.
 *
 * Nothing here imports anything, which is the property that makes it safe to
 * import from either side. It is text arithmetic and one sentence of English.
 */

/**
 * How much of a document is handed to the model at a time.
 *
 * A hundred-page posting converts to more tokens than a small model has context
 * for. This is the size of one window, not a limit on what can be read: a longer
 * document is read across several calls.
 */
export const CONTEXT_BUDGET = 12_000


/** One window onto a document, and the facts needed to ask for the next. */
export type DocumentPage = {
  /** The slice itself. */
  text: string
  /** Where this window starts. */
  from: number
  /** Where the next one starts, or null when this was the end. */
  next: number | null
  /** The whole document's length, so a reader knows how much is left. */
  total: number
}

/**
 * A window onto a long document, so the model can read past the first one.
 *
 * ## The failure this replaces
 *
 * `trimForModel` cut at the budget and said so — and that was the end of the
 * matter, because nothing could ask for the rest. A three-page CV became one
 * page, and the model, reading a note that said the document was longer,
 * correctly concluded it had no way to see more and told the person to paste
 * the rest by hand. It was right: there was no way. `vault.file.read` took an
 * id and nothing else.
 *
 * ## Why a character offset rather than pages
 *
 * MarkItDown returns one stream of Markdown with no page boundaries in it — a
 * PDF's pagination does not survive the conversion, so "page 2" is not a thing
 * this layer can honestly offer. An offset is what actually exists, and the
 * note below turns it into an instruction the model can follow without knowing
 * any of that.
 *
 * ## Cutting on a line break
 *
 * A window that ends mid-word costs the model the sentence it was reading, and
 * one that ends mid-table costs it the row. So the cut walks back to the last
 * newline in the final fifth of the window, and only takes the hard boundary
 * when there is no newline to find — a document with no line breaks at all.
 */
export function pageOf(
  markdown: string,
  from = 0,
  budget = CONTEXT_BUDGET,
): DocumentPage {
  const total = markdown.length
  const start = Math.max(0, Math.min(Math.trunc(from), total))
  if (total - start <= budget) {
    return { text: markdown.slice(start), from: start, next: null, total }
  }

  const hard = start + budget
  const lastBreak = markdown.lastIndexOf('\n', hard)
  // Only accept a break in the final fifth: an earlier one would throw away a
  // large part of a window that was paid for.
  const end = lastBreak > start + Math.floor(budget * 0.8) ? lastBreak : hard
  return { text: markdown.slice(start, end), from: start, next: end, total }
}

/**
 * What to append so the model knows there is more and how to get it.
 *
 * Names the exact call, with the argument filled in. A note that says only "the
 * document continues" leaves the model to invent a way of asking, and the way it
 * invents is usually to ask the PERSON — which is what happened.
 */
export function pageNote(page: DocumentPage, fileId: string): string {
  if (page.next === null) {
    return page.from === 0
      ? ''
      : `\n\n[End of the document — ${String(page.total)} characters in total.]`
  }
  const read = Math.round((page.next / page.total) * 100)
  return `\n\n[This is characters ${String(page.from)}–${String(page.next)} of ${String(page.total)} (about ${String(read)}%). THE DOCUMENT CONTINUES. To read the next part, call vault.file.read again with id "${fileId}" and from ${String(page.next)}. Do not ask the person to paste the rest — you can read it yourself.]`
}
