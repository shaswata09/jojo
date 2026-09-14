/**
 * Which documents can be tailored for an application, and which already were.
 * L1 core.
 *
 * The two questions the tailoring card asks of the graph, pulled out of the
 * panel for the reason every other `core/*` decision is: under D20 no panel is
 * mounted, so a rule left inside one is checked by clicking, twice.
 *
 * ## What counts as a base document
 *
 * ONLY the person's profile documents — which is to say, only the files in the
 * Vault's `Applications` bucket.
 *
 * Those two descriptions name one set, and that is worth saying plainly because
 * they sound like two: the profile page's document panel IS
 * `files.filter((f) => f.bucket === 'Applications')`, its own hint reads "the
 * Vault's Applications bucket", and `profile.document.add` is `vault.file.add`
 * with that bucket fixed. So "my profile documents" and "the Applications
 * bucket" are the same shelf reached by two doors.
 *
 * It used to be every readable file the person owned, minus job postings and
 * anything named after an employer. That is the right list for the twin, which
 * is looking for anything it might learn a fact from, and the wrong one here:
 * tailoring rewrites a document you SEND WITH AN APPLICATION, and the bucket is
 * the person's own statement of which documents those are. A conference talk, a
 * reading-list PDF and a scanned visa letter all passed the old filter and none
 * of them is something anybody tailors for a posting — they only made the
 * chooser longer and the right document harder to find.
 *
 * `readableDocuments` still does the rest of the work, and still owns the bytes
 * check: a record with no bytes behind it has nothing to read.
 *
 * The list is then sorted the way a hiring packet is assembled — CV, research
 * statement, teaching statement, cover letter, then whatever else — with the
 * kind read off the FILENAME alone. The classifier prefers text, but text costs
 * a read, and the chooser is drawn before anyone has pressed anything. The read
 * that follows re-classifies with the text in hand, and it is that answer, not
 * this one, that is stored on the snippet.
 */

import { DOCUMENT_LABEL, documentKindOf } from './document-kind'
import type { FileBucket, NodeId, ProfileDocument, SnippetTag, StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'
import { readableDocuments } from './twin'
import type { HasBytes } from './twin'

export type TailorCandidate = {
  readonly id: string
  readonly name: string
  readonly kind: ProfileDocument
  /** 'CV', 'research statement' — from `DOCUMENT_LABEL`. */
  readonly label: string
  /** A tailored snippet from this document already sits under the application. */
  readonly already: boolean
}

/**
 * The one bucket a document can be tailored from. See the header.
 *
 * Named here rather than spelled inline because three places already know it —
 * the profile page's panel, `profile.document.add`, and now this — and a fourth
 * spelling of a bucket name is how the profile page and the tailoring card
 * would quietly stop agreeing about which documents are yours.
 */
export const TAILORABLE_BUCKET: FileBucket = 'Applications'

/** The order a packet is assembled in. `other` last, always. */
export const KIND_ORDER: readonly ProfileDocument[] = [
  'cv',
  'research-statement',
  'teaching-statement',
  'cover-letter',
  'other',
]

/**
 * The snippet tag a tailored document is filed under.
 *
 * Three of these tags arrived with this map, and the Vault's tag picker offers
 * them to a person too — a CV somebody pastes in by hand is still a CV. `other`
 * goes under 'Application form': the honest reading of "a document that is
 * none of the four", which is usually a statement that ends up pasted into one.
 */
export const TAG_FOR_KIND: Readonly<Record<ProfileDocument, SnippetTag>> = {
  cv: 'CV',
  'research-statement': 'Research statement',
  'teaching-statement': 'Teaching statement',
  'cover-letter': 'Cover letter',
  other: 'Application form',
}

/** 'CV — Rice University'. The label capitalised, since it heads a card. */
export function titleFor(kind: ProfileDocument, org: string): string {
  const label = DOCUMENT_LABEL[kind]
  const head = label.charAt(0).toUpperCase() + label.slice(1)
  return org.trim() === '' ? head : `${head} — ${org.trim()}`
}

/**
 * Every tailored snippet filed under this application, newest first.
 *
 * `in`, because `FILED_UNDER` points from the snippet at the job. Only those
 * carrying `tailored`: a snippet the person filed here by hand is theirs to see
 * in the Vault and in the "Filed under" card, not a thing this card claims a
 * model wrote.
 */
export function tailoredFor(memory: GraphSnapshot, applicationId: string): StoredNode<'snippet'>[] {
  return memory
    .many(applicationId as NodeId, 'FILED_UNDER', 'in', 'snippet')
    .filter((n) => n.props.tailored !== undefined)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/**
 * The documents the card offers to tailor, in packet order.
 *
 * `already` is per document rather than per kind, because two CVs in the Vault
 * are two documents, and having tailored one says nothing about the other.
 */
export function candidatesFor(
  memory: GraphSnapshot,
  applicationId: string,
  hasBytes?: HasBytes,
): TailorCandidate[] {
  const done = new Set(tailoredFor(memory, applicationId).map((n) => n.props.tailored?.source))
  return readableDocuments(memory, hasBytes)
    // The person's own statement of what they send with an application. See
    // the header for why this is narrower than what the twin reads.
    .filter((doc) => memory.node(doc.id as NodeId, 'file')?.props.bucket === TAILORABLE_BUCKET)
    .map((doc): TailorCandidate => {
      const kind = documentKindOf(doc.name, '')
      return {
        id: doc.id,
        name: doc.name,
        kind,
        label: DOCUMENT_LABEL[kind],
        already: done.has(doc.id),
      }
    })
    .sort((a, b) => {
      const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      return byKind !== 0 ? byKind : a.name.localeCompare(b.name)
    })
}
