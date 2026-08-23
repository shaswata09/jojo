import { useCallback } from 'react'
import {
  POSTING_BUDGET,
  postingDocument,
  postingMessages,
  readPosting,
} from '@jojo/service/agent/read-posting'
import type { PostingDraft, PostingRead } from '@jojo/service/agent/read-posting'
import { canonicalPostingUrl } from '@jojo/service/core/capture'
import { sizeLabel } from '@jojo/service/core/files'
import { useVault } from '@/lib/store-context'
import type { VaultFile } from '@jojo/service/data/vault'
import { writeCapture } from '@/lib/capture'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { convertUrl } from '@/lib/markitdown'
import { byteLengthOf } from '@/lib/text'
import { now, TODAY } from '@/lib/today'

/**
 * A job posting URL, read by the model into a draft application.
 *
 * The phone's half of web's `lib/posting-agent.ts`, and deliberately the same
 * three steps in the same order with the same wording, because the two are one
 * feature and a person who learns it on one should recognise it on the other.
 * What differs is only where the bytes go: IndexedDB there, `writeCapture` and
 * a `file://` path here — which is the same split every other document in this
 * app already has.
 *
 * THE THREE STEPS ARE REPORTED, not hidden behind one spinner, because they
 * fail differently and the user can act on each. "The reader is not running" is
 * a Settings problem; "that page came back empty" is a page problem and the
 * in-app browser is the answer; "the model did not answer" is a third thing.
 *
 * WHY THE PAGE IS SAVED BEFORE THE FORM OPENS. The posting is a record in its
 * own right — somebody else's document, kept in the Vault under "Job postings" —
 * and it is worth keeping whether or not this particular form is submitted.
 * Cancelling leaves a saved posting and no application, which is exactly what
 * "I looked at this and decided not to apply" should leave behind.
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
 * `captureFileName` needs a page title, which this path does not have — the
 * reader returns text, not a document. The employer the model just read is a
 * better name than the hostname anyway, which is why this runs after the read.
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
  const { addFile, updateFile } = useVault()

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
            'This needs the document reader as well as the model — it is what fetches the page. Settings has the address.',
        }
      }

      /* ------------------------------ 1. read ------------------------------ */
      onStep?.('reading')
      const page = await convertUrl(reader, target, signal)
      if (!page.ok) return { ok: false, step: 'reading', reason: page.reason }

      // A page that converted to almost nothing is the JS-only board, caught
      // here rather than paying for a model call to be told the same thing. The
      // threshold is deliberately low: a real posting that short does not
      // exist, and anything above it goes to the model, which is the better
      // judge of whether it is a posting at all.
      if (page.markdown.trim().length < 200) {
        return {
          ok: false,
          step: 'reading',
          reason:
            'That page came back nearly empty. Boards that render with JavaScript send a blank shell to anything but a browser — open it here and save the page instead.',
        }
      }

      /* ------------------------------ 2. ask ------------------------------- */
      onStep?.('asking')
      const turn = await agentTurn(settings, postingMessages(target, page.markdown), [], signal)
      if (!turn.ok) return { ok: false, step: 'asking', reason: turn.reason }
      if (turn.text === null || turn.text.trim() === '') {
        return { ok: false, step: 'asking', reason: 'The model answered with nothing at all.' }
      }
      const read: PostingRead = readPosting(turn.text)
      if (!read.ok) return { ok: false, step: 'asking', reason: read.reason }

      /* ------------------------------ 3. save ------------------------------ */
      onStep?.('saving')
      // Wrapped, not raw: the record is `kind: 'page'` and `PageViewer` puts a
      // page in a WebView, which would collapse every newline in the markdown.
      const html = postingDocument(target, page.markdown)
      const name = nameFor(read.draft, target)

      const file = addFile({
        name,
        // The same kind the in-app browser's captures use. It is what earns the
        // "read it here" affordance and the link back to the original.
        kind: 'page',
        // The settled rule: a posting is somebody else's document and never
        // lands in 'Applications', which holds what the user wrote.
        bucket: 'Job postings',
        // Byte length, not `.length`: `String.length` counts UTF-16 units, so a
        // posting in Japanese reported roughly half its real size — and the web
        // side counts bytes, so the same page was labelled differently.
        size: sizeLabel(byteLengthOf(html)),
        sourceUrl: target,
        capturedAt: now(),
        savedOn: TODAY,
        note: `Read by the model from ${target}`,
      })

      // `updateFile` rather than a second create, exactly as `PostingBrowser`
      // does it: the record exists, and the file on disk is named after its id,
      // so the location is the one field that could not be known until it did.
      const uri = await writeCapture(file.id, html)
      updateFile(file.id, { uri })

      return {
        ok: true,
        // The URL is the one field the model is not asked for and cannot get
        // wrong, so it is set from what the user actually pasted.
        draft: { ...read.draft, url: target },
        file: { ...file, uri },
        missing: read.missing,
      }
    },
    [addFile, updateFile],
  )
}

export { POSTING_BUDGET }
