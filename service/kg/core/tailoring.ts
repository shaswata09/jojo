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
 * `readableDocuments` in `twin.ts` already knows: the person's own files with
 * bytes behind them, minus job postings and minus anything named after an
 * employer. That list is then sorted the way a hiring packet is assembled — CV,
 * research statement, teaching statement, cover letter, then whatever else —
 * with the kind read off the FILENAME alone. The classifier prefers text, but
 * text costs a read, and the chooser is drawn before anyone has pressed
 * anything. The read that follows re-classifies with the text in hand, and it
 * is that answer, not this one, that is stored on the snippet.
 */

import { DOCUMENT_LABEL, documentKindOf } from './document-kind'
import type { NodeId, ProfileDocument, SnippetTag, StoredNode } from './model'
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
