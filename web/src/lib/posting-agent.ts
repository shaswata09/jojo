import { useCallback } from 'react'
import {
  POSTING_BUDGET,
  postingDocument,
  askForPosting,
  postingMessages,
} from '@jojo/service/agent/read-posting'
import type { PostingDraft } from '@jojo/service/agent/read-posting'
import { canonicalPostingUrl } from '@jojo/service/core/capture'
import { sizeLabel } from '@jojo/service/core/files'
import { useVault } from '@jojo/service/react/use-vault'
import type { VaultFile } from '@jojo/service/data/vault'
import { TODAY } from '@/lib/today'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { convertUrl } from '@/lib/markitdown'
import { useVaultBlobs } from '@/lib/vault-blobs'

/**
 * A job posting URL, read by the model into a draft application.
 *
 * THE THREE STEPS ARE REPORTED, not hidden behind one spinner, because they
 * fail differently and the user can act on each. "The reader is not running" is
 * a Settings problem; "that page came back empty" is a page problem and the
 * extension is the answer; "the model did not answer" is a third thing again.
 * A single "could not add" would flatten all three into a shrug.
 *
 * WHY THE READER AND NOT `fetch`. The browser cannot read a cross-origin page —
 * a job board sends no CORS headers and never will — so the fetch has to happen
 * somewhere else. MarkItDown is already configured for reading documents, is
 * already running on this machine, and its `convert_to_markdown` takes an http
 * URI, so it is the fetch as well as the parse. See `lib/markitdown.ts`.
 *
 * WHY THE PAGE IS SAVED BEFORE THE FORM OPENS. The posting is a record in its
 * own right — the thing that belongs to somebody else, kept in the Vault under
 * "Job postings" — and it is worth keeping whether or not this particular form
 * is ever submitted. Postings outlive the applications they did not become.
 * Cancelling the form leaves a saved posting and no application, which is
 * exactly what "I looked at this and decided not to apply" should leave behind.
 */

export type PostingStep = 'reading' | 'asking' | 'saving'

export type PostingOutcome =
  | { ok: true; draft: PostingDraft; file: VaultFile; missing: readonly string[] }
  | { ok: false; step: PostingStep; reason: string }

export type ReadPostingOptions = {
  url: string
  settings: ModelSettings
  /** MarkItDown's address. Empty means the reader is not set up. */
  reader: string
  onStep?: (step: PostingStep) => void
  signal?: AbortSignal
}

/**
 * A filename for the saved page.
 *
 * `captureFileName` in `core/capture` needs a page title, which is exactly what
 * this path does not have — the reader returns markdown, not a document. The
 * employer the model just read is a better name than the hostname anyway, and
 * this runs after the read for that reason.
 */
function nameFor(draft: PostingDraft, url: string): string {
  const stem = [draft.org, draft.role].filter(Boolean).join(' — ')
  if (stem) return `${stem}.html`
  try {
    return `${new URL(url).hostname.replace(/^www\./, '')}.html`
  } catch {
    return 'Job posting.html'
  }
}

export function useReadPosting(): (options: ReadPostingOptions) => Promise<PostingOutcome> {
  const { addFile } = useVault()
  const blobs = useVaultBlobs()

  return useCallback(
    async ({
      url,
      settings,
      reader,
      onStep,
      signal,
    }: ReadPostingOptions): Promise<PostingOutcome> => {
      const target = canonicalPostingUrl(url.trim())

      if (reader.trim() === '') {
        return {
          ok: false,
          step: 'reading',
          reason:
            'This needs the document reader as well as the model — it is what fetches the page, because a browser is not allowed to read one from another site. Settings has the address.',
        }
      }

      /* ------------------------------ 1. read ------------------------------ */
      onStep?.('reading')
      const page = await convertUrl(reader, target, signal)
      if (!page.ok) return { ok: false, step: 'reading', reason: page.reason }

      // A page that converted to almost nothing is the JS-only board, and it is
      // worth catching HERE rather than paying for a model call to be told the
      // same thing. The threshold is deliberately low: a real posting that
      // short does not exist, and anything above it goes to the model, which is
      // the better judge of whether it is a posting.
      if (page.markdown.trim().length < 200) {
        return {
          ok: false,
          step: 'reading',
          reason:
            'That page came back nearly empty. Boards that render with JavaScript send a blank shell to anything but a browser — open it and use the extension to save the page instead.',
        }
      }

      /* ------------------------------ 2. ask ------------------------------- */
      onStep?.('asking')
      /*
       * Twice, if the first answer did not parse — see `askForPosting`. By this
       * line the page is already fetched and converted, so one malformed draw
       * from a small model used to cost the person the whole run.
       *
       * A REFUSED request is different and must not be repeated: it is carried
       * out here in a holder rather than returned, because the retry only knows
       * about answers and a server saying no is not one.
       */
      const refused: { reason?: string } = {}
      const read = await askForPosting(async () => {
        const turn = await agentTurn(settings, postingMessages(target, page.markdown, TODAY), [], signal)
        if (!turn.ok) {
          refused.reason = turn.reason
          return null
        }
        return turn.text
      })
      if (refused.reason !== undefined) return { ok: false, step: 'asking', reason: refused.reason }
      if (!read.ok) {
        // Said, because otherwise the obvious response to a slow failure is to
        // press the button again — which is the thing that just happened twice.
        const tried = read.attempts > 1 ? ' Asked twice, with the same result.' : ''
        return { ok: false, step: 'asking', reason: `${read.reason}${tried}` }
      }

      /* ------------------------------ 3. save ------------------------------ */
      onStep?.('saving')
      // Wrapped, not raw: the record is `kind: 'page'` and both viewers render a
      // page as HTML, which would collapse every newline in the markdown. See
      // `postingDocument`.
      const html = postingDocument(target, page.markdown)
      const bytes = new TextEncoder().encode(html)
      const name = nameFor(read.draft, target)

      const file = addFile({
        name,
        // 'page' rather than 'md': what was saved IS a captured posting, and the
        // kind is what the Vault's icon and the viewer key off. The extension's
        // captures use the same one.
        kind: 'page',
        // The settled rule: a posting is somebody else's document and never
        // lands in 'Applications', which holds what the user wrote.
        bucket: 'Job postings',
        size: sizeLabel(bytes.byteLength),
        sourceUrl: target,
        capturedAt: new Date().toISOString(),
        savedOn: TODAY,
        note: `Read by the model from ${target}`,
      })

      // Best effort, and reported through the record rather than thrown: the
      // row is already written, and a storage failure must not lose the draft
      // the user is about to be shown.
      await blobs.put(file.id, new File([bytes], name, { type: 'text/html' }))

      return {
        ok: true,
        // The URL is the one field the model is not asked for and cannot get
        // wrong, so it is set here from what the user actually pasted.
        draft: { ...read.draft, url: target },
        file,
        missing: read.missing,
      }
    },
    [addFile, blobs],
  )
}

export { POSTING_BUDGET }
