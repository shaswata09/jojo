/**
 * L1 — the vault's records: links, files and snippets, and the tailoring
 * provenance a snippet can carry. Re-exported by `core/model.ts`.
 */

import type { Instant, ISODate } from './model-graph'
import type { NoteSpan } from './model-format'
import type { PostingReading } from './model-scout'

export const LINK_CATEGORY_VALUES = ['Posting', 'Institution', 'Person', 'Guide'] as const
export type LinkCategory = (typeof LINK_CATEGORY_VALUES)[number]

export type VaultLink = {
  id: string
  title: string
  url: string
  category: LinkCategory
  note?: string
  /** ISO date the record was filed. Rendered through `agoLabel`. */
  savedOn: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
}

/**
 * The five drawers a document can be in.
 *
 * 'Job postings' is the newest and is the only one nothing of the user's goes
 * into by hand: it is where the extension files a captured listing. It exists
 * because those captures were going to 'Applications', which is the drawer for
 * the things a person WROTE — the CV, the statements, the cover letters. A
 * posting is somebody else's document about the job, kept for reference, and
 * mixing it in meant the Profile page's Documents card — which is that drawer,
 * filtered — filled up with pages the user never put there.
 *
 * Ordered as the filters read, so the two drawers about a job sit together.
 */
export const FILE_BUCKET_VALUES = [
  'To read',
  'Applications',
  'Job postings',
  'Talks',
  'Admin',
] as const
export type FileBucket = (typeof FILE_BUCKET_VALUES)[number]

/**
 * `page` is the fifth, and it is the first kind whose bytes jojo produced rather
 * than received.
 *
 * A job posting is the one document in a search that belongs to somebody else
 * and disappears on their schedule — the listing is pulled the week after the
 * interview, and with it the requirements the user is about to be asked about.
 * So a page is a CAPTURE: the posting as it read on the day it was filed,
 * serialised with every stylesheet, image and font rewritten to a `data:` URI so
 * that opening it a year later reads the same and reaches nothing.
 *
 * That last clause is the reason it is a kind of its own rather than a `doc`
 * with an .html name. Every other kind is inert to a viewer — a PDF reader
 * cannot be talked into fetching a tracking pixel. This one is live markup from
 * a site nobody here controls, so it carries a rule the other four do not: it is
 * rendered with scripts off and no network, and `core/capture.ts` owns what
 * counts as a well-formed one.
 */
export const FILE_KIND_VALUES = ['pdf', 'doc', 'slides', 'note', 'page'] as const
export type FileKind = (typeof FILE_KIND_VALUES)[number]

export type VaultFile = {
  id: string
  name: string
  kind: FileKind
  bucket: FileBucket
  size: string
  /** ISO date the record was filed. Rendered through `agoLabel`. */
  savedOn: string
  note?: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
  /** See `FileProps.uri`. Projected straight through by `projections.files`. */
  uri?: string
  /** See `FileProps.sourceUrl`. Straight through, and never followed by a viewer. */
  sourceUrl?: string
  /** See `FileProps.capturedAt`. Straight through. */
  capturedAt?: Instant
}

/*
 * The last three name a DOCUMENT rather than a use, and they arrived together
 * with tailoring (2026-09-13): a CV rewritten for one posting is a snippet —
 * text to copy into the real document — but "Application form" would have been
 * a lie about what it is. 'Cover letter' already sat on the list for the same
 * reason, which is what made the line worth crossing.
 */
export const SNIPPET_TAG_VALUES = [
  'Cover letter',
  'Application form',
  'Email',
  'Bio',
  'CV',
  'Research statement',
  'Teaching statement',
] as const
export type SnippetTag = (typeof SNIPPET_TAG_VALUES)[number]

export type Snippet = {
  id: string
  title: string
  tag: SnippetTag
  body: string
  /**
   * Every application this is filed under, newest edge last.
   *
   * A LIST, and it replaced a scalar `applicationId`. The scalar was not a
   * simplification of this, it was a constraint disguised as one: a CV goes to
   * every job you send it to, and a field that holds one id filed it under
   * whichever you touched last — which is not filing it, it is losing it from
   * the other nine. Empty rather than absent, so a caller never has to ask which
   * kind of nothing it is looking at.
   */
  applicationIds: string[]
  /** Set when a model wrote this for one posting. See `TailoredFrom`. */
  tailored?: TailoredFrom
}

/**
 * The kinds of document a person applies with.
 *
 * Declared here rather than in `core/document-kind.ts`, which owned it, since
 * the day a kind became a stored value — `TailoredFrom.kind` — and everything
 * that goes on disk is described in `core/model.ts`. `document-kind.ts` re-exports
 * it, so every reader of the classifier still finds it where it expects to.
 *
 * `other` is the open lane, for the same reason `BACKGROUND_KINDS` has one: a
 * document that is none of the four is still a document, and a closed list
 * would have to refuse it or lie about it.
 */
export const PROFILE_DOCUMENTS = [
  'cv',
  'research-statement',
  'teaching-statement',
  'cover-letter',
  'other',
] as const
export type ProfileDocument = (typeof PROFILE_DOCUMENTS)[number]

/**
 * Where a tailored snippet came from, and enough about it to be doubted.
 *
 * A model wrote this body for one posting, out of one of the person's own
 * documents. The four fields are what the card needs to say so: which document
 * (`source`, a file id — a breadcrumb, not a foreign key, exactly as
 * `BackgroundProps.source` is; the file may be gone and the snippet still
 * stands), what kind it was, which model, and when.
 *
 * It describes ORIGIN, not current content. A person who edits the body in the
 * Vault leaves this in place, as they would a "read from" line on a background
 * fact — the snippet was tailored from that document, and editing it afterwards
 * does not make that untrue. What it must never do is survive a copy: a
 * duplicate the person made is not the model's output, and
 * `vault.snippet.duplicate` drops it.
 */
export type TailoredFrom = {
  /** The id of the `file` node the base document was. Not validated as one. */
  source: string
  /** What that document was, as `documentKindOf` classified it at the time. */
  kind: ProfileDocument
  /** The model that wrote it — 'gemma_4_31b'. Shown, never used to decide anything. */
  model: string
  /** When, from `ctx.now`. */
  at: Instant
}

export type LinkProps = {
  slug: string
  title: string
  url: string
  category: LinkCategory
  note?: string
  savedOn: ISODate
}

export type FileProps = {
  slug: string
  name: string
  kind: FileKind
  bucket: FileBucket
  /** '184 KB' — a label the user reads. `bytes` below is the number. */
  size: string
  savedOn: ISODate
  note?: string
  /**
   * The formatting over `note`. See `ApplicationProps.noteFormat`, whose rules
   * this shares exactly — one module owns what a span is, for all three fields
   * that carry them.
   *
   * The vault's list still prints `note` as plain text, and that is the point
   * of keeping formatting beside the text rather than inside it: the row, the
   * search index and anything a model is shown read the string, and only the
   * drawer that drew the formatting reads the spans.
   */
  noteFormat?: NoteSpan[]

  /*
   * The four link fields. All optional, and their absence is a valid, complete
   * state — a record with no `path` is every file that predates the folder, and
   * every file belonging to a user who has not connected one. Nothing is wrong
   * with such a record and the UI must not mark it as broken.
   *
   * D27's binary-free invariant is intact: these are a path and three facts
   * about bytes, never the bytes, so `getAll('nodes')` is the same 5 ms
   * operation it was. What is stale is D27's stated TRIGGER — it said a blobs
   * store "arrives with the server", and there is no server; the bytes live in
   * a folder the user picked, reached through `storage/file-store.ts`. If the
   * architecture doc still reads "no `File` in the graph", that sentence is
   * describing the trigger and not this field, and there is no numbered
   * decision recording the port. Do not read the absence as a prohibition.
   */

  /** Folder-relative POSIX path. Its PRESENCE is the "has bytes" flag. Write-once. */
  path?: string
  /** True byte count. `size` is a label rounded into a 1,024-byte window. */
  bytes?: number
  /** `File.lastModified`, epoch ms. A tripwire for drift, never identity. */
  mtime?: number
  /** 'sha256:<64 hex>'. The only field that can say "these are the same bytes". */
  hash?: string

  /**
   * Absolute device URI of a copy inside app storage. NATIVE ONLY, and the
   * fifth of five location fields rather than a synonym for `path`.
   *
   * It arrived here from the phone's fork of `core/model.ts`, where its header called
   * itself "the one divergence from the web app's copy" — a copy-maintenance
   * note the extraction made obsolete, which is why it is restated as a fact
   * about the field instead. `path` above is a folder-RELATIVE name inside a
   * directory the user granted, resolved through `storage/file-store.ts`;
   * this is an ABSOLUTE path into the app's own document directory, written by
   * `expo-file-system` after the picker copied the file there. They describe
   * different facts, and collapsing either into the other would lose the one
   * distinction that decides whether a document is still reachable after a
   * reinstall — a `path` that survives one against a `uri` that does not.
   *
   * It is declared in `validate.ts` alongside the other four and listed in
   * `SALVAGEABLE_FILE_PROPS`. Until this move it was declared on the phone and
   * validated by nobody, so `uri: 99` reached `openDocument(file.uri)` in
   * `screens/vault/FileViewer.tsx` intact.
   *
   * The successor is the RN `FileStore` adapter over `expo-file-system`: once
   * that satisfies `storage/file-store-conformance.ts`, new records write
   * `path` and this field stops being written. Existing records keep it, so it
   * does not become removable by that alone. That adapter is deferred, and this
   * comment is where the deferral is recorded rather than a line in a document.
   */
  uri?: string

  /**
   * The page this file was captured from. `kind: 'page'` only.
   *
   * Kept because the capture is a copy of something that had an address, and the
   * address is half of what makes the copy trustworthy a year later: it is what
   * the record can be checked against while the original still exists, and what
   * the user reads when they are trying to remember which of four Workday
   * listings this was. It is NOT a fallback the viewer may quietly follow —
   * opening a capture must never reach the network, or the archive becomes a
   * tracker that fires every time somebody revisits their own notes.
   *
   * Validated as a string here and re-checked against `CAPTURE_SCHEMES` before
   * anything renders it as a link, because a stored `javascript:` would
   * otherwise arrive at an `href` intact.
   */
  sourceUrl?: string
  /**
   * When the capture was taken, which is not `savedOn`.
   *
   * `savedOn` is a date and means "when this record was filed"; a posting saved
   * from a tab left open for a week was captured on a day the user may care
   * about separately. Instant rather than ISODate so a second capture of the
   * same posting sorts against the first.
   */
  capturedAt?: Instant

  /**
   * What a model read off this posting, kept so it is not read again.
   *
   * ## Why this is stored at all
   *
   * `use-read-fit.ts` held it in a module Map and said, in writing, that it
   * must not survive a reload. That was wrong in the way a person notices: the
   * fit panel re-read the posting on every refresh, so opening the same
   * application twice in a morning spent two model calls and fifteen seconds to
   * arrive back at the answer it already had. A cache whose only invalidation
   * is losing the tab is not an invalidation strategy; it is an outage every
   * time the tab is closed.
   *
   * ## Why it is not a derived value
   *
   * The rule at the top of `core/model.ts` says no derived value goes on disk, and a
   * derived value is one `project.ts` could recompute from what is stored.
   * Nothing can recompute this: it took a non-deterministic model call over
   * bytes the graph deliberately does not hold. It is an OBSERVATION — the
   * same category as `background` (a model's reading of a CV), `claim`, and
   * `ThreadProps.context` (a model's summary, stored on the thread it
   * summarises beside its own watermark). What stays derived is the SCORE:
   * `assess` and `guidanceFrom` still run on every render, so recording a new
   * publication moves the verdict without asking a model anything.
   *
   * ## Why it lives on the file rather than on the application
   *
   * Because it is a fact about the posting, not about the job hunt. Two
   * applications to the same listing weigh themselves against one reading, and
   * the panel already says which document it measured against. Storing it here
   * also means it is deleted when the document is — `tx.del` takes the props
   * with it — and that re-capturing a posting mints a NEW file id, so a stored
   * reading can never silently describe a page it was not read from: the id
   * the panel asks about has moved on, and the old reading is simply not found.
   */
  reading?: PostingReading
}

export type SnippetProps = {
  slug: string
  title: string
  tag: SnippetTag
  /**
   * Plain text — with one exception. A snippet a model TAILORED carries inline
   * marks in the four spellings `core/marks.ts` reads (`**changed**`,
   * `_reworded_`, `__moved up__`, `## heading`), so the person can see what was
   * altered for the posting. Only a body whose record carries `tailored` is
   * read that way; a hand-written snippet with an underscore in it stays what
   * it is. Copy strips the marks.
   */
  body: string
  /**
   * The formatting over `body`, as offsets into it. Same shape and same rules
   * as an application's `noteFormat` — `core/note-format.ts` is the only thing
   * that decides what a well-formed list of spans is, for every field carrying
   * them.
   *
   * Offsets into the STORED string, marks and all. A tailored body carries
   * `**changed**` as characters, and the spans are measured over the text as it
   * is stored rather than as `core/marks.ts` displays it — so neither mechanism
   * has to know about the other. What that costs, said plainly: formatting
   * applied across a `**` pair is measured against characters that Copy strips,
   * and Copy takes plain text anyway.
   */
  bodyFormat?: NoteSpan[]
  /** Set when a model wrote this for one posting. See `TailoredFrom`. */
  tailored?: TailoredFrom
}
