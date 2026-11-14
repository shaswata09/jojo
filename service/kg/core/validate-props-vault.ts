/**
 * Prop schemas for the vault: keywords, links, files, snippets and the people
 * in the search. Assembled into `NODE_PROP_SCHEMAS` in `validate-props.ts`.
 */

import {
  FILE_BUCKET_VALUES,
  FILE_KIND_VALUES,
  LABEL_TONE_VALUES,
  LINK_CATEGORY_VALUES,
  MAX_BRIEF_HIGHLIGHTS,
  MAX_BRIEF_HIGHLIGHT_TEXT,
  MAX_BRIEF_NOTE_TEXT,
  MAX_BRIEFS,
  MAX_NOTE_SPANS,
  MAX_REQUIREMENT_TEXT,
  MAX_REQUIREMENTS,
  PROFILE_DOCUMENTS,
  SNIPPET_TAG_VALUES,
} from './model'
import { noteSpanShape } from './note-format'
import { s } from './schema'
import { slug } from './validate-props-slug'

export const keywordProps = s.object({
  slug,
  name: s.string({ min: 1, label: 'Name' }),
  tone: s.enum(LABEL_TONE_VALUES, { label: 'Colour' }),
  /*
   * A colour off the spectrum, when none of the eight named ones was it.
   *
   * `s.hexColor` is the whole guarantee, and it is why this can be a free
   * value where `NoteSpan.colour` deliberately cannot be a string at all: it
   * parses '#rgb' and '#rrggbb' and refuses everything else, so what reaches
   * a renderer is one of sixteen million inert values and never a string that
   * could be interpreted. Anything else — a colour name, a `url(...)`, a
   * half-written hex — fails here, on the way in and on the way back from a
   * backup.
   *
   * IN `SALVAGEABLE_PROPS`: a node that fails validation is dropped WHOLE, so
   * a malformed colour must not take the keyword with it — its name, and
   * every record tagged with it. Stripped, the keyword comes back in its
   * `tone`, which is why that field stayed required beside this one.
   */
  ink: s.optional(s.hexColor({ label: 'Custom colour' })),
})

export const linkProps = s.object({
  slug,
  title: s.string({ min: 1, label: 'Title' }),
  url: s.string({ min: 1, label: 'Link' }),
  category: s.enum(LINK_CATEGORY_VALUES, { label: 'Category' }),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  savedOn: s.isoDate({ label: 'Saved on' }),
})

export const fileProps = s.object({
  slug,
  name: s.string({ min: 1, label: 'Name' }),
  kind: s.enum(FILE_KIND_VALUES, { label: 'Kind' }),
  bucket: s.enum(FILE_BUCKET_VALUES, { label: 'Bucket' }),
  size: s.string({ label: 'Size' }),
  savedOn: s.isoDate({ label: 'Saved on' }),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  /*
   * The formatting over that note. Same shape, same bound and same salvage
   * rule as an application's — one module decides what a span is, and one
   * bound decides how much formatting a field may carry.
   */
  noteFormat: s.optional(
    s.array(noteSpanShape, { max: MAX_NOTE_SPANS, label: 'Note formatting' }),
  ),
  // Declared rather than left to unknown-key passthrough, so a wrong value is
  // caught at the trust boundary instead of reaching `sizeLabel`. The cost is
  // that a bad value fails the whole node — which is why the restore path,
  // and only the restore path, passes `salvage` to strip these five and keep
  // the record. See `SALVAGEABLE_FILE_PROPS`.
  path: s.optional(s.string({ label: 'File path' })),
  bytes: s.optional(s.number({ min: 0, label: 'Bytes' })),
  mtime: s.optional(s.number({ min: 0, label: 'Modified' })),
  hash: s.optional(s.string({ label: 'Hash' })),
  // `uri` is the fifth, and it is the only one of them either app has ever
  // written. It came across from the phone's fork undeclared, so `s.object`'s
  // unknown-key passthrough carried it — which is the same door a `uri: 99`
  // came through, straight into `openDocument()`. Declaring it closes that
  // without changing what a well-formed record does.
  uri: s.optional(s.string({ label: 'Location' })),
  // A capture's two fields. `sourceUrl` is declared rather than left to
  // passthrough for the same reason `uri` was: it reaches an `href` in both
  // apps, and a stored `javascript:` that arrived as an unknown key would get
  // there intact. The scheme itself is checked by `isCaptureSource` at the
  // point of rendering — a string is all the trust boundary can promise, and
  // failing the whole node over a bad scheme would lose the capture's bytes
  // along with its address.
  sourceUrl: s.optional(s.string({ label: 'Captured from' })),
  capturedAt: s.optional(s.instant({ label: 'Captured' })),
  /*
   * What a model read off this posting. See `PostingReading`.
   *
   * Declared exactly, not passed through, and bounded on both axes: a list
   * longer than `MAX_REQUIREMENTS` or a phrase longer than a sentence did not
   * come from the reader, and the bound is what keeps a prop that arrived
   * from a backup file from becoming the 40k of prose D27 exists to keep out
   * of `getAll('nodes')`.
   *
   * IN `SALVAGEABLE_FILE_PROPS`, for the reason the list itself gives: a node
   * that fails validation is dropped WHOLE, taking its name, its note and
   * every edge incident to it — so a malformed reading in a restored backup
   * would cost the person the document record and its filing under a job, to
   * protect them from a stale requirement list. Stripping it costs one model
   * call. The first draft of this comment argued the opposite and was wrong
   * about which side of the trade the user is on.
   */
  reading: s.optional(
    s.object({
      requirements: s.array(
        s.object({
          text: s.string({ min: 1, max: MAX_REQUIREMENT_TEXT, label: 'Requirement' }),
          essential: s.boolean({ label: 'Required' }),
        }),
        { max: MAX_REQUIREMENTS, label: 'What it asks for' },
      ),
      model: s.string({ label: 'Read by' }),
      readAt: s.instant({ label: 'Read' }),
      skipped: s.optional(s.number({ min: 0, int: true, label: 'Lines skipped' })),
      clearedAt: s.optional(s.instant({ label: 'Cleared' })),
    }),
  ),
})

export const snippetProps = s.object({
  slug,
  title: s.string({ min: 1, label: 'Title' }),
  tag: s.enum(SNIPPET_TAG_VALUES, { label: 'Tag' }),
  body: s.string({ label: 'Body', multiline: true }),
  /* The formatting over that body. See the application's, which it mirrors. */
  bodyFormat: s.optional(
    s.array(noteSpanShape, { max: MAX_NOTE_SPANS, label: 'Body formatting' }),
  ),
  /*
   * Where a model-tailored snippet came from. See `TailoredFrom`. Declared
   * exactly, as `reading` is above; `source` is a string and not `s.id`, for
   * the reason `background.source` gives — the file may have been deleted
   * before a backup was taken, and the snippet is still the person's.
   */
  tailored: s.optional(
    s.object({
      source: s.string({ min: 1, label: 'Tailored from' }),
      kind: s.enum(PROFILE_DOCUMENTS, { label: 'Document kind' }),
      model: s.string({ min: 1, label: 'Written by' }),
      at: s.instant({ label: 'Written' }),
    }),
  ),
})

/**
 * Someone in the search. Only the name is required.
 *
 * Every other field is optional because the first thing recorded about a
 * referee is usually that they exist and have not sent the letter — and a
 * schema that demanded an email before it would keep a name is a schema
 * people work around by typing the name into a note, which is the state this
 * replaces. `email` is not validated as an address: half of what lands here
 * is pasted out of a signature block, and rejecting `a.chen (at) rice.edu`
 * would lose the only contact detail the user has.
 */
export const personProps = s.object({
  slug,
  name: s.string({ min: 1, label: 'Name' }),
  role: s.optional(s.string({ label: 'Role' })),
  affiliation: s.optional(s.string({ label: 'Affiliation' })),
  email: s.optional(s.string({ label: 'Email' })),
  phone: s.optional(s.string({ label: 'Phone' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
  /*
   * What the person is asked to highlight for each application. See
   * `RefereeBrief`. Declared rather than passed through, with the bounds
   * `vault.person.update` enforces, because it reaches a spreadsheet sent to
   * somebody else and a hand-edited backup is the one writer that skips the
   * tool. IN `SALVAGEABLE_PROPS`: a malformed brief costs the briefs, not the
   * person and every job they are filed under.
   */
  briefs: s.optional(
    s.array(
      s.object({
        applicationId: s.string({ min: 1, label: 'Application' }),
        highlights: s.optional(
          s.array(s.string({ max: MAX_BRIEF_HIGHLIGHT_TEXT, label: 'Highlight' }), {
            max: MAX_BRIEF_HIGHLIGHTS,
            label: 'Highlights',
          }),
        ),
        note: s.optional(s.string({ max: MAX_BRIEF_NOTE_TEXT, label: 'Note', multiline: true })),
      }),
      { max: MAX_BRIEFS, label: 'Briefs' },
    ),
  ),
})
