/**
 * Which document holds the posting an application came from. L1 core.
 *
 * `assess.ts` needs a list of requirements, `read-requirements.ts` needs the
 * posting's text to produce one, and an application does not store any. It has
 * a role, a note, a tag, a source and a comp — every one of them something the
 * user typed — so the text has to be found rather than read off the record.
 *
 * ## Why this is a lookup and not a field
 *
 * The obvious alternative is to put the posting text on the application when it
 * is created. It was rejected: it duplicates bytes the Vault already holds, it
 * goes stale the moment the capture is replaced, and it puts 40k of somebody
 * else's prose into `getAll('nodes')` — the operation the whole binary-free
 * invariant exists to keep at 5 ms.
 *
 * So the join is computed, and the honest consequence is that it can come back
 * empty. An application typed in by hand has no posting behind it, and the
 * right answer for one is "there is no posting text to assess against" rather
 * than a requirement list conjured from its role title. Inventing requirements
 * would produce a fit score that looks exactly like a real one.
 *
 * ## Three ways to find it, and the order is confidence
 *
 * `filed-under` is the user's own act — they attached this document to this
 * job — and nothing beats it. `same-url` is the importer's and the extension's
 * trail: both write `sourceUrl` on the file and the same address onto the
 * application, so the two records agree without anybody having linked them.
 * `via-posting` is the scout's: a `posting` node promoted into an application
 * keeps a `BECAME` edge, and the posting's own URL leads to the capture.
 *
 * `how` is returned rather than kept private because the screen says it. A
 * person looking at a fit score needs to be able to see WHICH page it was
 * measured against — a `same-url` match on a board's search page rather than
 * the listing is the failure that would otherwise be invisible.
 */

import type { GraphSnapshot } from './snapshot'
import type { NodeId, StoredNode } from './model'

export type PostingSource = {
  readonly fileId: string
  readonly name: string
  /** The URL the document was captured from, when it has one. */
  readonly url?: string
  /** How the join was made. Shown, so a wrong one can be spotted. */
  readonly how: 'filed-under' | 'same-url' | 'via-posting'
}

/**
 * Comparable form of a URL.
 *
 * No fragment, no trailing slash. Host case needs no handling of its own:
 * `URL` lowercases it on parse, and a `toLowerCase()` here was dead code that
 * no mutation could kill. The query is KEPT — job
 * boards put the listing id there (`?gh_jid=4012`), so dropping it would make
 * every posting on Greenhouse look like the same page and hand an application
 * the requirements of whichever listing was captured first.
 *
 * Returns null rather than throwing on something that is not a URL. Both fields
 * this compares are free text a user can type into, and a malformed one should
 * mean "no match" rather than take down the screen it is rendered on.
 */
function comparable(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  try {
    const url = new URL(value.trim())
    const path = url.pathname.endsWith('/') && url.pathname !== '/'
      ? url.pathname.slice(0, -1)
      : url.pathname
    return `${url.protocol}//${url.host}${path}${url.search}`
  } catch {
    return null
  }
}

/** A saved posting rather than something the user wrote. */
const isPosting = (file: StoredNode<'file'>): boolean =>
  file.props.bucket === 'Job postings' || file.props.kind === 'page'

const asSource = (file: StoredNode<'file'>, how: PostingSource['how']): PostingSource => ({
  fileId: file.id,
  name: file.props.name,
  ...(file.props.sourceUrl === undefined ? {} : { url: file.props.sourceUrl }),
  how,
})

/**
 * The newest captured posting saved from this address, or undefined.
 *
 * Newest because a second capture of the same URL is a re-read of a listing
 * that changed, and the later one is what the person is applying against.
 */
function fileByUrl(
  files: readonly StoredNode<'file'>[],
  url: string | undefined,
): StoredNode<'file'> | undefined {
  const wanted = comparable(url)
  if (wanted === null) return undefined
  const match = files.filter((f) => isPosting(f) && comparable(f.props.sourceUrl) === wanted)
  return match[match.length - 1]
}

/**
 * The posting saved from an address, without an application to ask about.
 *
 * The create form's half. An application does not exist yet when somebody
 * presses Save — or rather it does, but a snapshot taken before the write does
 * not hold it — so this answers the same question from the one field the form
 * has: the URL that was pasted. It lets the requirements be read while the
 * person carries on, so that opening the record shows a fit rather than a
 * spinner.
 */
export function postingSourceForUrl(
  memory: GraphSnapshot,
  url: string | undefined,
): PostingSource | null {
  const found = fileByUrl(memory.ofType('file'), url)
  return found ? asSource(found, 'same-url') : null
}

/**
 * The document holding this application's posting, or null.
 *
 * Null is a real answer and callers must render it as one. It means the person
 * typed this application in, or captured it before jojo kept the page — not
 * that anything is broken.
 */
export function postingSourceFor(
  memory: GraphSnapshot,
  applicationId: string,
): PostingSource | null {
  const application = memory.node(applicationId as NodeId, 'application')
  if (!application) return null

  /*
   * 1. What the user attached themselves.
   *
   * `in`, because `FILED_UNDER` points from the document at the job. Newest
   * first: somebody who attaches a second capture is correcting the first, and
   * ids are uuidv7 so id order is creation order.
   */
  const filed = memory
    .many(applicationId as NodeId, 'FILED_UNDER', 'in', 'file')
    .filter(isPosting)
  const newest = filed[filed.length - 1]
  if (newest) return asSource(newest, 'filed-under')

  const files = memory.ofType('file')

  /*
   * 2. The importer's and the extension's trail.
   *
   * `AddFromLinkDialog` saves the page with `sourceUrl` set to what was pasted
   * and opens the create form with `url` set to the same string; the capture
   * extension does the equivalent. Neither links the two records — this is what
   * stands in for that link, and it is why the comparison has to normalise
   * rather than use `===`.
   */
  const byUrl = fileByUrl(files, application.props.url)
  if (byUrl) return asSource(byUrl, 'same-url')

  /*
   * 3. The scout's.
   *
   * A `posting` node promoted into an application keeps a `BECAME` edge, and
   * the posting carries the address the capture was taken from. Last because a
   * promoted posting usually has its URL on the application too — this only
   * fires when it does not.
   */
  for (const posting of memory.many(applicationId as NodeId, 'BECAME', 'in', 'posting')) {
    const found = fileByUrl(files, posting.props.url)
    if (found) return asSource(found, 'via-posting')
  }

  return null
}

/** What the screen calls each way of finding it. Short, and honest about doubt. */
export const HOW_LABEL: Readonly<Record<PostingSource['how'], string>> = {
  'filed-under': 'filed under this application',
  'same-url': 'matched by web address',
  'via-posting': 'from the posting the scout found',
}
