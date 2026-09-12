import { useCallback } from 'react'
import {
  POSTING_BUDGET,
  postingDocument,
  askForPosting,
  keywordRoster,
  matchKeywords,
  postingMessages,
  postingTextFromHtml,
} from '@jojo/service/agent/read-posting'
import type { PostingDraft } from '@jojo/service/agent/read-posting'
import { canonicalPostingUrl } from '@jojo/service/core/capture'
import type { CaptureEnvelope } from '@jojo/service/core/capture'
import { sizeLabel } from '@jojo/service/core/files'
import { useVault } from '@jojo/service/react/use-vault'
import type { VaultFile } from '@jojo/service/data/vault'
import { TODAY } from '@/lib/today'
import { capturePage } from '@/lib/capture-bridge'
import { useLabels } from '@/lib/labels-context'
import { useFileCapture } from '@/lib/file-capture'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { convertUrl } from '@/lib/markitdown'
import { useVaultBlobs } from '@/lib/vault-blobs'

/**
 * A job posting URL, read by the model into a draft application.
 *
 * THE THREE STEPS ARE REPORTED, not hidden behind one spinner, because they
 * fail differently and the user can act on each. "Sign in to that board" is a
 * page problem; "the extension is older than this page" is a reload; "the
 * model did not answer" is a third thing again. A single "could not add" would
 * flatten all of them into a shrug.
 *
 * WHY THE EXTENSION FIRST, AND THE READER SECOND. The browser cannot read a
 * cross-origin page — a job board sends no CORS headers and never will — so the
 * page has to be opened by something that is not a page. The extension opens
 * it the way the person would, signed in as they are, waits for it to render,
 * and hands back the page itself: the model reads the posting as it appears on
 * screen, and the Vault keeps the real page, filed exactly as the extension's
 * own Capture button files one. MarkItDown can fetch an http URI too, and is
 * kept for a browser without the extension — but it fetches server-side, and
 * a board that renders in JavaScript sends it an empty shell.
 *
 * This read went through MarkItDown alone until 2026-09-11, which meant a
 * person with a model connected and no reader running got "this needs the
 * document reader" on the first step, and one with both still got a blank page
 * from half the boards they use and a `<pre>` text dump in their Vault.
 *
 * NOT A FALLBACK CHAIN. The reader is used when the extension is ABSENT, which
 * is a fact about this browser; it is not tried after the extension FAILS,
 * which is a fact about the page. A posting that wants a sign-in wants one from
 * the reader too, and trying it would replace the useful sentence with a worse
 * one.
 *
 * WHY THE PAGE IS SAVED BEFORE THE FORM OPENS. The posting is a record in its
 * own right — the thing that belongs to somebody else, kept in the Vault under
 * "Job postings" — and it is worth keeping whether or not this particular form
 * is ever submitted. Its id rides into the form, which files it under the
 * application when one is created. Cancelling leaves a saved posting and no
 * application, which is exactly what "I looked at this and decided not to
 * apply" should leave behind.
 */

export type PostingStep = 'reading' | 'asking' | 'saving'

/** Which way the page was read. The two keep different copies, so the toast says which. */
export type PostingRoute = 'extension' | 'reader'

export type PostingOutcome =
  | {
      ok: true
      draft: PostingDraft
      file: VaultFile
      missing: readonly string[]
      /**
       * Keyword IDS, ready for the create form's picker to open with ticked.
       *
       * Ids and not names: `keywordsOf` hands this straight to the staged
       * picker, and `application.create` takes `s.id('keyword')`. Empty is the
       * ordinary answer — see `matchKeywords`, which would rather offer nothing
       * than offer the vocabulary back.
       */
      keywords: readonly string[]
      via: PostingRoute
    }
  | { ok: false; step: PostingStep; reason: string }

export type ReadPostingOptions = {
  url: string
  settings: ModelSettings
  /** MarkItDown's address. Empty means the reader is not set up. */
  reader: string
  onStep?: (step: PostingStep) => void
  signal?: AbortSignal
}

/** The page, read one way or the other, with the text the model is shown. */
type Page =
  { via: 'extension'; text: string; capture: CaptureEnvelope } | { via: 'reader'; text: string }

/** Said when there is nothing in this browser that can open a page at all. */
const NOTHING_TO_READ_WITH =
  'Reading a posting needs the jojo browser extension, which opens the page the way you would and saves it, or the document reader, which fetches it. Neither is set up in this browser — Settings has both.'

/**
 * Opens the page: through the extension when there is one, the reader when not.
 *
 * See the header for why the order is availability and never failure.
 */
async function openPage(
  target: string,
  reader: string,
  signal?: AbortSignal,
): Promise<Page | { reason: string }> {
  const captured = await capturePage(target, signal)
  if (captured.ok) {
    return {
      via: 'extension',
      text: postingTextFromHtml(captured.capture.html),
      capture: captured.capture,
    }
  }
  if (!captured.absent) return { reason: captured.reason }
  if (reader.trim() === '') return { reason: NOTHING_TO_READ_WITH }
  const converted = await convertUrl(reader, target, signal)
  return converted.ok ? { via: 'reader', text: converted.markdown } : { reason: converted.reason }
}

/**
 * A filename for a page the READER saved.
 *
 * `captureFileName` in `core/capture` needs a page title, which is exactly what
 * this route does not have — the reader returns markdown, not a document. The
 * employer the model just read is a better name than the hostname anyway, and
 * this runs after the read for that reason. The extension's route has the
 * page's own title and is named the way its captures always are.
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
  const fileCapture = useFileCapture()
  /*
   * The person's own vocabulary, so the model can pick from it rather than
   * inventing words nobody files anything under.
   *
   * Read here and cut ONCE below, so the list the prompt offers and the list
   * the reply is matched against are the same value rather than two calls that
   * agree today. `labels` is a new identity on every graph write — including
   * the `addFile` this very read performs — so the callback below is
   * re-identified mid-run; that is benign because the one effect that starts it
   * is guarded by a `started` ref (`AddFromLinkDialog`), and a read already in
   * flight holds its own closure.
   */
  const { labels, countFor } = useLabels()

  return useCallback(
    async ({
      url,
      settings,
      reader,
      onStep,
      signal,
    }: ReadPostingOptions): Promise<PostingOutcome> => {
      const target = canonicalPostingUrl(url.trim())
      const offered = keywordRoster(
        labels.map((label) => ({ id: label.id, name: label.name, used: countFor(label.id) })),
      )

      /* ------------------------------ 1. read ------------------------------ */
      onStep?.('reading')
      const page = await openPage(target, reader, signal)
      if ('reason' in page) return { ok: false, step: 'reading', reason: page.reason }

      // A page that came back as almost nothing is worth catching HERE rather
      // than paying for a model call to be told the same thing. The threshold
      // is deliberately low: a real posting that short does not exist, and
      // anything above it goes to the model, which is the better judge.
      if (page.text.trim().length < 200) {
        return {
          ok: false,
          step: 'reading',
          reason:
            page.via === 'extension'
              ? 'That page came back nearly empty. It may not have finished loading, or it may want you signed in — open it in a tab, and try again once it shows the posting.'
              : 'That page came back nearly empty. Boards that render with JavaScript send a blank shell to anything but a browser — install the jojo extension and it will open the page the way you would.',
        }
      }

      /* ------------------------------ 2. ask ------------------------------- */
      onStep?.('asking')
      /*
       * Twice, if the first answer did not parse — see `askForPosting`. By this
       * line the page is already open and read, so one malformed draw from a
       * small model used to cost the person the whole run.
       *
       * A REFUSED request is different and must not be repeated: it is carried
       * out here in a holder rather than returned, because the retry only knows
       * about answers and a server saying no is not one.
       */
      const refused: { reason?: string } = {}
      const read = await askForPosting(async () => {
        const turn = await agentTurn(
          settings,
          postingMessages(target, page.text, TODAY, offered),
          [],
          signal,
        )
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
      const file =
        page.via === 'extension'
          ? // Filed by the same hook the capture inbox uses, so a posting saved
            // from a pasted link and one saved with the Capture button are one
            // kind of record: same drawer, same name, same note, same bytes.
            (await fileCapture(page.capture)).file
          : await (async () => {
              // Wrapped, not raw: the record is `kind: 'page'` and both viewers
              // render a page as HTML, which would collapse every newline in the
              // markdown. See `postingDocument`.
              const html = postingDocument(target, page.text)
              const bytes = new TextEncoder().encode(html)
              const name = nameFor(read.draft, target)
              const saved = addFile({
                name,
                // 'page' rather than 'md': what was saved IS a posting, and the
                // kind is what the Vault's icon and the viewer key off.
                kind: 'page',
                // The settled rule: a posting is somebody else's document and
                // never lands in 'Applications', which holds what the user wrote.
                bucket: 'Job postings',
                size: sizeLabel(bytes.byteLength),
                sourceUrl: target,
                capturedAt: new Date().toISOString(),
                savedOn: TODAY,
                note: `Read by the model from ${target}`,
              })
              // Best effort, and reported through the record rather than thrown:
              // the row is already written, and a storage failure must not lose
              // the draft the user is about to be shown.
              await blobs.put(saved.id, new File([bytes], name, { type: 'text/html' }))
              return saved
            })()

      return {
        ok: true,
        // The URL is the one field the model is not asked for and cannot get
        // wrong, so it is set here from what the user actually pasted.
        draft: { ...read.draft, url: target },
        file,
        missing: read.missing,
        // Names in, ids out, and the crossing happens exactly here.
        keywords: matchKeywords(offered, read.keywordNames),
        via: page.via,
      }
    },
    [addFile, blobs, fileCapture, labels, countFor],
  )
}

export { POSTING_BUDGET }
