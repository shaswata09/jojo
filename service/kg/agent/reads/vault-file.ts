/**
 * `vault.file.read`: the inside of a stored document, a page at a time, inside
 * the document fence.
 */

import type { NodeId } from '../../core/model'
import { s } from '../../core/schema'
import { pageNote, pageOf } from '../paging'
import { defineRead } from './define'
import { DOCUMENT_CLOSE, DOCUMENT_OPEN, unfenceable } from './fence'
import { STOPPED } from './shared'

/**
 * Reads a document in the Vault, through MarkItDown.
 *
 * The tool the whole integration exists for. Everything else the agent can do
 * with a file — rename it, file it under a job, delete it — treats the document
 * as an opaque thing with a name; this is the one that opens it. A model that
 * can read the posting can answer questions about the posting.
 *
 * It refuses rather than fails when nothing is configured, and says what to
 * install. The alternative is a model that keeps trying and a user who never
 * learns why it cannot.
 */
export const vaultFileRead = defineRead({
  name: 'vault.file.read',
  title: 'Read a document',
  summary:
    'Read what is inside a stored document — a PDF, a Word file, a deck, a spreadsheet — as text. Use it before answering questions about a posting, a CV or anything else filed in the Vault. A long document arrives in parts: read it again with `from` set to the offset the previous part ended at until you reach the end. Read to the end before filing anything from it: on a CV, the later parts are where the publications are.',
  effect: 'read',
  input: s.object({
    id: s.id('file', { label: 'Document', description: 'The id of the file to read.' }),
    /*
     * The offset, which is what makes a long document readable at all.
     *
     * Without it this tool took an id and returned the first twelve thousand
     * characters with a note saying the document was longer — and the model,
     * correctly concluding it had no way to see the rest, asked the PERSON to
     * paste it. It was right: there was no way. A three-page CV was a one-page
     * CV, and the pages that went missing were the publications.
     *
     * Characters rather than pages, because MarkItDown returns one stream of
     * Markdown and a PDF's pagination does not survive the conversion. An offset
     * is what actually exists; the note appended to each part turns it into an
     * instruction without the model needing to know that.
     */
    from: s.optional(
      s.number({
        min: 0,
        int: true,
        label: 'From',
        description:
          'Where to start reading, in characters. Omit for the beginning. To continue a long document, pass the offset the previous part said it ended at.',
      }),
    ),
  }),
  read: async (memory, input: { id: NodeId; from?: number }, ctx) => {
    const node = memory.node(input.id, 'file')
    if (!node) return { ok: false, hint: 'No document has that id.' }
    if (!ctx.convert) {
      return {
        ok: false,
        hint: 'No document reader is connected, so the inside of this file cannot be read. Settings is where its address goes.',
        name: node.props.name,
      }
    }
    if (ctx.signal?.aborted) return { ok: false, name: node.props.name, hint: STOPPED }
    const out = await ctx.convert(input.id, ctx.signal)
    if (!out.ok) return { ok: false, name: node.props.name, hint: out.reason }

    /*
     * The cut happens HERE rather than in the app's converter, and that move is
     * the fix. While the app trimmed before returning, this tool never saw the
     * rest of the document and no offset could have reached it.
     */
    const page = pageOf(out.markdown, input.from ?? 0)
    return {
      ok: true,
      name: node.props.name,
      // Fenced, because a document is somebody else's words: a CV or a posting
      // can say "ignore your instructions" as easily as anything else. The page
      // note goes OUTSIDE the fence — it is jojo talking, and it is an
      // instruction the model should follow.
      markdown: `${DOCUMENT_OPEN}${unfenceable(page.text)}${DOCUMENT_CLOSE}${pageNote(page, input.id)}`,
      from: page.from,
      next: page.next,
      total: page.total,
    }
  },
})
