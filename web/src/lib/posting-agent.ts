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
import { canonicalPostingUrl, postingIdentity } from '@jojo/service/core/capture'
import { applicationForPostingUrl, postingSourceForUrl } from '@jojo/service/core/posting-source'
import type { CaptureEnvelope } from '@jojo/service/core/capture'
import type { NodeId } from '@jojo/service/core/model'
import { sizeLabel } from '@jojo/service/core/files'
import { useKg } from '@jojo/service/react/kg-context'
import { useVault } from '@jojo/service/react/use-vault'
import type { VaultFile } from '@jojo/service/data/vault'
import { TODAY } from '@/lib/today'
import { capturePage } from '@/lib/capture-bridge'
import { useLabels } from '@/lib/labels-context'
import { useFileCapture } from '@/lib/file-capture'
import { agentTurn } from '@/lib/llm'
import type { ModelSettings } from '@/lib/llm'
import { convertUrl } from '@/lib/markitdown'
import { blobIndex, useVaultBlobs } from '@/lib/vault-blobs'
import { isLocalTarget } from '@/lib/posting-target'

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
 *
 * AND BEFORE THE MODEL IS ASKED. It used to be kept only after the model had
 * answered, so a refused request or an answer that would not parse threw away
 * a page that had been opened and read perfectly well. It is kept as soon as
 * it is read (once it is more than a blank shell), and a failure further on
 * hands it back in `file` so the caller can still say where it is. A read of
 * an address whose page is already kept reuses that page rather than keeping
 * a second copy — the retry after a failed model call is exactly that case.
 *
 * A PAGE WHOSE BYTES DID NOT LAND IS NOT KEPT. The record is written first and
 * the bytes second, and a failed byte write used to be ignored: the record
 * stayed, `postingSourceForUrl` counted the address as kept for ever, and the
 * page was never fetched again. Now the record is taken back out and the
 * failure is said, so trying again can work.
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
      /**
       * True when this read kept the page; false when it reused one already in
       * the Vault. Whoever may later take the page back out (a discarded scout
       * suggestion) must only ever take one it created — a reused page can be
       * the person's own clip of the address (R9).
       */
      created: boolean
    }
  | {
      ok: false
      step: PostingStep
      reason: string
      /** As on success: whether `file` was kept by this read. */
      created?: boolean
      /**
       * The page, when it was kept before the step that failed — so a model
       * that refused or a reply that would not parse does not cost the person
       * the page they had already opened.
       */
      file?: VaultFile
    }

export type ReadPostingOptions = {
  url: string
  settings: ModelSettings
  /** MarkItDown's address. Empty means the reader is not set up. */
  reader: string
  onStep?: (step: PostingStep) => void
  signal?: AbortSignal
  /**
   * A copy of this page the Vault already holds. The page is still opened —
   * the model reads the live text — but not saved a second time; the outcome
   * carries this file instead.
   */
  reuseFile?: VaultFile
}

/** The page, read one way or the other, with the text the model is shown. */
type Page =
  { via: 'extension'; text: string; capture: CaptureEnvelope } | { via: 'reader'; text: string }

/** Said for an address on this machine or the person's own network. */
export const LOCAL_TARGET =
  'That address is on this computer or your own network, not a job board — jojo does not open those.'

/** Said when there is nothing in this browser that can open a page at all. */
export const NOTHING_TO_READ_WITH =
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
  // Before either route: the extension refuses these for itself, the reader
  // never did, and its fetch runs on the person's own machine (R6).
  if (isLocalTarget(target)) return { reason: LOCAL_TARGET }
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
function nameFor(stem: string, url: string): string {
  if (stem.trim()) return `${stem.trim()}.html`
  try {
    return `${new URL(url).hostname.replace(/^www\./, '')}.html`
  } catch {
    return 'Job posting.html'
  }
}

/** Said when the record was written and its bytes were not. */
const NOT_STORED =
  'The page was read, but this browser would not store it — it may be out of room for jojo. Nothing was kept; free some space and try again.'

/** Said when the page came back as almost nothing — per route, because the fix differs. */
function nearlyEmpty(via: PostingRoute): string {
  return via === 'extension'
    ? 'That page came back nearly empty. It may not have finished loading, or it may want you signed in — open it in a tab, and try again once it shows the posting.'
    : 'That page came back nearly empty. Boards that render with JavaScript send a blank shell to anything but a browser — install the jojo extension and it will open the page the way you would.'
}

/**
 * Keeps a page that was read, the way its route keeps one.
 *
 * One function for both callers — the "From link" read and the scout keeping a
 * posting it found — so a page saved either way is one kind of record: same
 * drawer, same name, same note, same bytes.
 *
 * `null` when the bytes did not land. The record written a moment earlier is
 * removed again first, so nothing is left claiming the page is kept — see
 * "A PAGE WHOSE BYTES DID NOT LAND" in the header.
 */
function useSavePage(): (page: Page, target: string, stem: string) => Promise<VaultFile | null> {
  const { addFile, removeFile } = useVault()
  const blobs = useVaultBlobs()
  const fileCapture = useFileCapture()
  return useCallback(
    async (page: Page, target: string, stem: string): Promise<VaultFile | null> => {
      let kept: { file: VaultFile; stored: boolean }
      if (page.via === 'extension') {
        // Filed by the same hook the capture inbox uses, so a posting saved
        // from a pasted link and one saved with the Capture button are one
        // kind of record: same drawer, same name, same note, same bytes.
        const filed = await fileCapture(page.capture)
        kept = { file: filed.file, stored: filed.stored }
      } else {
        // Wrapped, not raw: the record is `kind: 'page'` and both viewers
        // render a page as HTML, which would collapse every newline in the
        // markdown. See `postingDocument`.
        const html = postingDocument(target, page.text)
        const bytes = new TextEncoder().encode(html)
        const name = nameFor(stem, target)
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
        const stored = await blobs.put(saved.id, new File([bytes], name, { type: 'text/html' }))
        kept = { file: saved, stored }
      }
      return keptOrDropped(kept, removeFile)
    },
    [addFile, removeFile, blobs, fileCapture],
  )
}

/**
 * The page, or `null` with its record taken back out when the bytes did not
 * land. Exported for its test: this is the line that decides whether a URL is
 * counted as kept for ever.
 */
export function keptOrDropped(
  kept: { file: VaultFile; stored: boolean },
  removeFile: (id: string) => unknown,
): VaultFile | null {
  if (kept.stored) return kept.file
  removeFile(kept.file.id)
  return null
}

/**
 * The kept page a read may reuse instead of keeping the fresh one: the record
 * for this address, but only while its bytes are on this device.
 *
 * A record alone is not a copy. One whose bytes never landed here (another
 * device's record, a restore without its documents) used to be reused, and the
 * page just read — the only copy there was — was thrown away (R17). The newer
 * record wins `postingSourceForUrl`, so saving it also makes it the one found.
 */
export function reusablePage<F extends { id: string }>(
  fileId: string | undefined,
  files: readonly F[],
  hasBytes: (id: string) => boolean,
): F | undefined {
  if (fileId === undefined || !hasBytes(fileId)) return undefined
  return files.find((f) => f.id === fileId)
}

export function useReadPosting(): (options: ReadPostingOptions) => Promise<PostingOutcome> {
  const savePage = useSavePage()
  const blobs = useVaultBlobs()
  const { repo, projections } = useKg()
  const { updateFile } = useVault()
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
      reuseFile,
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
        return { ok: false, step: 'reading', reason: nearlyEmpty(page.via) }
      }

      // Kept NOW, before the model is asked — see "AND BEFORE THE MODEL IS
      // ASKED" in the header. A page this address already has is reused, so a
      // second try after a failed ask does not keep a second copy.
      // The index first: before it hydrates every `has` is false.
      await blobIndex.ready()
      const graph = repo.getSnapshot()
      const source = postingSourceForUrl(graph, target)
      const already =
        reuseFile ?? reusablePage(source?.fileId, projections.files(graph), blobs.has)
      const file = already ?? (await savePage(page, target, ''))
      if (file === null) return { ok: false, step: 'saving', reason: NOT_STORED }
      const created = already === undefined

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
      if (refused.reason !== undefined) {
        return { ok: false, step: 'asking', reason: refused.reason, file, created }
      }
      if (!read.ok) {
        // Said, because otherwise the obvious response to a slow failure is to
        // press the button again — which is the thing that just happened twice.
        const tried = read.attempts > 1 ? ' Asked twice, with the same result.' : ''
        return { ok: false, step: 'asking', reason: `${read.reason}${tried}`, file, created }
      }

      /* ------------------------------ 3. save ------------------------------ */
      onStep?.('saving')
      // The reader's copy was kept before there was anything better to call
      // it than the host; the employer the model just read is a better name.
      // The extension's copy is named from the page's own title and kept so.
      const stem = [read.draft.org, read.draft.role].filter(Boolean).join(' — ')
      let named = file
      if (already === undefined && page.via === 'reader' && stem.trim() !== '') {
        const name = nameFor(stem, target)
        if (updateFile(file.id, { name }).ok) named = { ...file, name }
      }

      return {
        ok: true,
        // The URL is the one field the model is not asked for and cannot get
        // wrong, so it is set here from what the user actually pasted.
        draft: { ...read.draft, url: target },
        file: named,
        missing: read.missing,
        // Names in, ids out, and the crossing happens exactly here.
        keywords: matchKeywords(offered, read.keywordNames),
        via: page.via,
        created,
      }
    },
    [savePage, blobs, labels, countFor, repo, projections, updateFile],
  )
}

export type KeptPage =
  | {
      ok: true
      fileId: string
      name: string
      /** How it was kept, or 'already' when a page for this address was in the Vault. */
      via: PostingRoute | 'already'
      /** The application it was filed under, when the posting had become one. */
      filedUnder?: string
    }
  | { ok: false; reason: string }

export type KeepPageOptions = {
  url: string
  /** What the posting is called, for naming a page the reader saved. */
  title: string
  /** MarkItDown's address. Empty means the reader is not set up. */
  reader: string
  signal?: AbortSignal
}

/**
 * Pages being kept right now, by posting identity.
 *
 * Module-level, not a ref: approving a posting and pressing "Add to
 * applications" a second later both ask for the same page, and the second press
 * navigates away and unmounts the screen that started the first. One tab, one
 * store, one list of what is in flight — so the two share a capture instead of
 * opening the board twice and keeping two copies.
 */
const inFlight = new Map<string, Promise<KeptPage>>()

/**
 * Keeps the page of a posting the scout found, the way "From link" keeps one.
 *
 * The first step of `useReadPosting` and its save, with the model left out:
 * the scout already wrote down what the job is, and what was missing was the
 * page itself — so an approved posting had a link and nothing else, and the
 * listing coming down took the requirements with it.
 *
 * The page's SOURCE is the posting's own address, not wherever the tab ended
 * up. A board that redirects within itself would otherwise leave the page under
 * an address no posting and no application carries, and both ways the app finds
 * a posting's page — `postingSourceFor` and the filing in
 * `scout.posting.promote` — go by address.
 *
 * FILED UNDER THE APPLICATION WHEN IT FINISHES LAST. Promoting files the page
 * if it is already kept; a capture takes seconds, so a promote pressed while
 * it runs finds nothing to file. The finished capture then asks a FRESH
 * snapshot whether the posting has become an application — fresh, because the
 * screen that started it has usually navigated away by then and its own copy
 * of the store stopped updating when it unmounted.
 */
export function useKeepPostingPage(): (options: KeepPageOptions) => Promise<KeptPage> {
  const savePage = useSavePage()
  const blobs = useVaultBlobs()
  const { repo, projections } = useKg()
  const { updateFile } = useVault()
  return useCallback(
    (options: KeepPageOptions): Promise<KeptPage> => {
      // Postings are stored the way they were typed, and the seeded ones carry
      // no scheme — a tab cannot open 'jobs.rice.edu/postings/29411'.
      const raw = options.url.trim()
      const target = canonicalPostingUrl(
        /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
      )
      const key = postingIdentity(target) ?? target
      const running = inFlight.get(key)
      if (running) return running
      // Only for a posting that is actually saved. Approve all approves first
      // and keeps pages after, and an approval that failed would otherwise
      // leave a page in the Vault about a job nothing points at.
      const saved = projections
        .postings(repo.getSnapshot())
        .some((p) => (postingIdentity(p.url) ?? p.url) === key)
      if (!saved) {
        return Promise.resolve({
          ok: false,
          reason: 'That posting is not saved, so there is no page to keep for it.',
        })
      }

      const run = (async (): Promise<KeptPage> => {
        // Kept already counts only with its bytes on this device — see
        // `reusablePage`. A record without them is fetched again (R17). After
        // the index has loaded, or every page would look missing.
        await blobIndex.ready()
        const kept = postingSourceForUrl(repo.getSnapshot(), target)
        if (kept && blobs.has(kept.fileId))
          return { ok: true, fileId: kept.fileId, name: kept.name, via: 'already' }
        const opened = await openPage(target, options.reader, options.signal)
        if ('reason' in opened) return { ok: false, reason: opened.reason }
        if (opened.text.trim().length < 200) return { ok: false, reason: nearlyEmpty(opened.via) }
        const page: Page =
          opened.via === 'extension'
            ? { ...opened, capture: { ...opened.capture, url: target } }
            : opened
        const file = await savePage(page, target, options.title)
        // The bytes did not land and the record is already gone again, so
        // nothing counts this address as kept and the next ask re-fetches it.
        // Returned (not thrown) inside the in-flight promise, whose `finally`
        // clears the entry — a retry starts a fresh capture.
        if (file === null) return { ok: false, reason: NOT_STORED }

        const graph = repo.getSnapshot()
        const application = applicationForPostingUrl(projections.postings(graph), target)
        if (application === undefined)
          return { ok: true, fileId: file.id, name: file.name, via: page.via }
        const filed = graph
          .many(file.id as NodeId, 'FILED_UNDER', 'out', 'application')
          .map((a) => a.id)
        updateFile(file.id, { applicationIds: [...new Set([...filed, application])] })
        return {
          ok: true,
          fileId: file.id,
          name: file.name,
          via: page.via,
          filedUnder: application,
        }
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, run)
      return run
    },
    [savePage, blobs, repo, projections, updateFile],
  )
}

export { POSTING_BUDGET }
