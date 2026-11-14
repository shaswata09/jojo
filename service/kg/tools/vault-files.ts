/**
 * L3 — the vault's file tools. Records only: a name, a size label and a bucket,
 * never the bytes (D27). The filing rules all four vault files share are in
 * `vault-shared.ts`.
 */

import { decodeFormat, normaliseFormat, retextFormat } from '../core/note-format'
import { FILE_BUCKET_VALUES, FILE_KIND_VALUES } from '../core/model'
import type { NodeId } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import { dayOf, opt } from './support'
import { applicationIds, cleared, fileUnder } from './vault-shared'

const fileId = s.id('file', { label: 'File' })

const fileDraft = s.object({
  name: s.string({ min: 1, label: 'Name' }),
  kind: s.enum(FILE_KIND_VALUES, { label: 'Kind' }),
  bucket: s.enum(FILE_BUCKET_VALUES, { label: 'Bucket' }),
  /** '184 KB' — a label the user reads. No bytes are held, ever (D27). */
  size: s.string({ label: 'Size' }),
  /** Where the copy landed on this device. Native only — see `FileProps.uri`. */
  uri: s.optional(s.string({ label: 'Location' })),
  note: s.optional(s.string({ label: 'Note' })),
  savedOn: s.optional(s.isoDate()),
  applicationIds: s.optional(s.nullable(s.array(s.id('application')))),
  /**
   * A capture's provenance. `kind: 'page'` only, and optional even then, because
   * a page the user saved by hand and dropped in has bytes and no address.
   *
   * On the draft rather than in a tool of its own: a capture differs from a
   * dropped PDF in where its bytes came from, not in what filing it means. A
   * second create tool would be a second slug mint, a second `fileUnder`, a
   * second undo shape and one more thing to keep in step for no behaviour
   * anybody asked for.
   */
  sourceUrl: s.optional(s.string({ label: 'Captured from' })),
  capturedAt: s.optional(s.instant({ label: 'Captured' })),
})

/**
 * Bulk, because a drop is bulk.
 *
 * `addFile` minted its slug from a store read that predated the whole gesture,
 * so two files dropped together both took the same id and from then on were one
 * row with one keyword set that one delete took out together. `sortDrop` in
 * `components/vault/files/intake.ts` used to work that around by predicting the
 * minted slug; it dedupes on the folded name now. Here `ctx.mintSlug` reads the
 * transaction overlay, so each `tx.put` below is visible to the next draft's
 * mint — which is what made that prediction unnecessary, and the whole drop is
 * one commit and one Undo.
 *
 * That last clause is the part not currently delivered. `useVault().addFile`
 * passes a list of one and `components/vault/FilesTool.tsx` calls it in a `for`
 * loop, so a ten-file drop is ten transactions, ten journal rows and an undo
 * hand-built as ten deletes — the opposite of what `files: FileDraft[]` and the
 * `min: 1` below exist for. Nothing needs to change HERE to fix it: the caller
 * passes the array.
 */
export const vaultFileAdd = defineTool({
  name: 'vault.file.add',
  title: 'Add files',
  summary: 'Files one or more documents in the Vault. No file contents are read.',
  effect: 'create',
  touches: ['file'],
  input: s.object({ files: s.array(fileDraft, { min: 1, label: 'Files' }) }),

  run(ctx, input): NodeId[] {
    return input.files.map((draft) => {
      const id = ctx.newId('file')
      ctx.tx.put({
        id,
        type: 'file',
        props: {
          slug: ctx.mintSlug('file', draft.name),
          name: draft.name.trim(),
          kind: draft.kind,
          bucket: draft.bucket,
          size: draft.size,
          savedOn: draft.savedOn ?? dayOf(ctx.now),
          ...(draft.uri === undefined ? {} : { uri: draft.uri }),
          ...(draft.sourceUrl === undefined ? {} : { sourceUrl: draft.sourceUrl }),
          ...(draft.capturedAt === undefined ? {} : { capturedAt: draft.capturedAt }),
          ...opt('note', cleared(draft.note)),
        },
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      fileUnder(ctx, id, draft.applicationIds)
      return id
    })
  },

  describe: (_input, ids) => ({
    title: ids.length === 1 ? 'Document added' : `${ids.length} documents added`,
    description: `The name, size and type are kept — the file itself is not read.`,
  }),
})

export const vaultFileUpdate = defineTool({
  name: 'vault.file.update',
  title: 'Edit file',
  summary: 'Saves the file record’s name, kind, bucket and note.',
  effect: 'update',
  touches: ['file'],
  input: s.object({
    id: fileId,
    name: s.optional(s.string({ min: 1, label: 'Name' })),
    kind: s.optional(s.enum(FILE_KIND_VALUES, { label: 'Kind' })),
    bucket: s.optional(s.enum(FILE_BUCKET_VALUES, { label: 'Bucket' })),
    note: s.optional(s.string({ label: 'Note' })),
    /*
     * ONE STRING, for the reason `application.note.set` sets out at length: the
     * same spans as a JSON-Schema array cost about 1,100 characters on every
     * model request, for a parameter no model should ever produce. The notes
     * drawer writes it; everything else leaves it out and keeps what is there.
     */
    noteFormat: s.optional(
      s.string({
        label: 'Note formatting',
        description: "Written by the file's notes drawer. Leave this out; the existing formatting is kept.",
      }),
    ),
    size: s.optional(s.string({ label: 'Size' })),
    /*
     * Writable AFTER the record exists, which is the only order a capture can
     * use: the file on disk is named after the record's id, so the location
     * cannot be known until the id is. It was absent here, so
     * `updateFile(id, { uri })` parsed clean, wrote nothing, and every posting
     * captured on a phone lost track of its own bytes — the viewer then said
     * "no saved copy on this device" about a file that was sitting right there.
     *
     * The same shape of omission `vault.file.add`'s header describes for this
     * exact field: declared in one place, not forwarded in another, and
     * therefore written by nobody.
     */
    uri: s.optional(s.string({ label: 'Location' })),
    savedOn: s.optional(s.isoDate()),
    applicationIds,
  }),

  run(ctx, input) {
    const current = ctx.require('file', input.id)
    const note = input.note === undefined ? undefined : cleared(input.note)
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
      ...(input.note === undefined ? {} : { note }),
      /*
       * The formatting follows the text, exactly as an application's note does.
       *
       * Given spans, they are canonicalised against the text being saved with
       * them. Given none while the TEXT changes — the phone, a rename, an agent
       * — the existing spans are moved onto the new text, so fixing a typo
       * costs the formatting on that word rather than on the whole note. Given
       * neither, nothing is written at all.
       */
      ...(input.noteFormat !== undefined
        ? { noteFormat: normaliseFormat(note ?? '', decodeFormat(input.noteFormat)) }
        : input.note === undefined
          ? {}
          : {
              noteFormat: retextFormat(current.props.note ?? '', note ?? '', current.props.noteFormat),
            }),
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.uri === undefined ? {} : { uri: input.uri }),
      ...(input.savedOn === undefined ? {} : { savedOn: input.savedOn }),
    }
    /*
     * Only when there is something to patch.
     *
     * Filing a document under a job changes no property of the document — it is
     * an edge — but this used to run `tx.patch` with an empty object anyway,
     * which stamps `updatedAt` and puts a NODE delta on the journal entry
     * describing a record that did not change.
     *
     * That delta is not free. `movedOn` in `react/undo.ts` compares a record
     * against the image an entry left behind, and refuses to revert anything it
     * finds has moved since — so any later write to the same file made the
     * create form's "Undo" report "you have changed those records since" about a
     * record the person had not touched. Measured when the fit panel started
     * storing its reading on the posting: creating an application from a link
     * files the page here, the read finishes a few seconds later, and pressing
     * Undo on the toast that is still up accused the user of an edit a
     * background read had made.
     */
    if (Object.keys(patch).length > 0) ctx.tx.patch<'file'>(input.id, patch)
    fileUnder(ctx, input.id, input.applicationIds)
  },

  describe: (input, _output, m) => ({
    title: 'File saved',
    description: m.node(input.id, 'file')?.props.name ?? '',
  }),
})

export const vaultFileDelete = defineTool({
  name: 'vault.file.delete',
  title: 'Delete file',
  summary: 'Removes the file record. No bytes were ever held.',
  effect: 'delete',
  touches: ['file'],
  input: s.object({ id: fileId }),

  run(ctx, input) {
    ctx.require('file', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'File removed',
    description: m.node(input.id, 'file')?.props.name ?? '',
    tone: 'danger',
  }),
})

export const vaultFileMove = defineTool({
  name: 'vault.file.move',
  title: 'Move file',
  summary: 'Files the document under a different bucket.',
  effect: 'move',
  touches: ['file'],
  input: s.object({ id: fileId, bucket: s.enum(FILE_BUCKET_VALUES, { label: 'Bucket' }) }),

  run(ctx, input) {
    ctx.require('file', input.id)
    ctx.tx.patch<'file'>(input.id, { bucket: input.bucket })
  },

  describe: (input) => ({ title: `Moved to ${input.bucket}` }),
})

export const vaultFileNoteSet = defineTool({
  name: 'vault.file.note.set',
  title: 'Edit file note',
  summary: 'Replaces the note on a file record.',
  effect: 'update',
  touches: ['file'],
  input: s.object({ id: fileId, note: s.string({ label: 'Note' }) }),

  run(ctx, input) {
    const current = ctx.require('file', input.id)
    const note = cleared(input.note)
    // The spans follow the text, as in `vault.file.update`. Left alone, a bold
    // "URGENT" stayed on the first six characters of whatever replaced it.
    ctx.tx.patch<'file'>(input.id, {
      note,
      noteFormat: retextFormat(current.props.note ?? '', note ?? '', current.props.noteFormat),
    })
  },

  describe: (input) => ({ title: input.note.trim() ? 'Note saved' : 'Note cleared' }),
})
