/**
 * L3 — the vault tools: links, files and snippets.
 *
 * Three collections that take the same three edits, so the shape below repeats
 * on purpose rather than being generalised: `useCollectionActions`
 * (in the removed `store-context.ts`) proved one generic serves them, and it also
 * proved what that costs — the generic could not carry a rule that belonged to
 * one of them, so `savedOn`, the id prefix and the name field all had to be
 * passed in as parameters and the call sites became the documentation.
 *
 * No file bytes. `lib/files.ts`'s header — "Nothing here reads file CONTENT" — is
 * the existing statement of this and D27 makes it an invariant: `props` is
 * binary-free, so `getAll('nodes')` stays a five-millisecond operation. A file
 * record is a name, a size label and a bucket.
 */

import {
  FILE_BUCKET_VALUES,
  FILE_KIND_VALUES,
  LINK_CATEGORY_VALUES,
  SNIPPET_TAG_VALUES,
} from '../core/model'
import type { NodeId } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import type { ToolContext } from './tool'
import { dayOf, opt } from './support'

/** `null` unfiles it; absent leaves the edge alone. The two are not the same. */
const applicationId = s.optional(s.nullable(s.id('application', { label: 'Filed under' })))

const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/** `FILED_UNDER` is `fromCardinality: 'one'`, so a second link replaces the first. */
function fileUnder(ctx: ToolContext, id: NodeId, appId: NodeId | null | undefined) {
  if (appId === undefined) return
  // Absent had to go on meaning "leave it where it is", or renaming a link
  // would have unfiled it from the application it was saved against.
  if (appId === null) ctx.tx.unlinkAll(id, { rel: 'FILED_UNDER' })
  else ctx.tx.link(id, 'FILED_UNDER', appId)
}

/* ---------------------------------- links --------------------------------- */

const linkId = s.id('link', { label: 'Link' })

export const vaultLinkSave = defineTool({
  name: 'vault.link.save',
  title: 'Save link',
  summary: 'Files a URL in the Vault, under a category.',
  effect: 'create',
  touches: ['link'],
  input: s.object({
    title: s.string({ min: 1, label: 'Title' }),
    url: s.string({ min: 1, label: 'Link' }),
    category: s.enum(LINK_CATEGORY_VALUES, { label: 'Category' }),
    note: s.optional(s.string({ label: 'Note' })),
    savedOn: s.optional(s.isoDate()),
    applicationId,
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('link')
    ctx.tx.put({
      id,
      type: 'link',
      props: {
        slug: ctx.mintSlug('link', input.title),
        title: input.title.trim(),
        url: input.url.trim(),
        category: input.category,
        // A real date, through `agoLabel` like every other row. This used to be
        // the frozen string 'just now', which made a link you saved yourself the
        // one record in the vault whose age could never change.
        savedOn: input.savedOn ?? dayOf(ctx.now),
        ...opt('note', cleared(input.note)),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    fileUnder(ctx, id, input.applicationId)
    return id
  },

  describe: (input) => ({ title: 'Link saved', description: input.title.trim() }),
})

export const vaultLinkUpdate = defineTool({
  name: 'vault.link.update',
  title: 'Edit link',
  summary: 'Saves the link’s title, URL, category and note.',
  effect: 'update',
  touches: ['link'],
  input: s.object({
    id: linkId,
    title: s.optional(s.string({ min: 1, label: 'Title' })),
    url: s.optional(s.string({ min: 1, label: 'Link' })),
    category: s.optional(s.enum(LINK_CATEGORY_VALUES, { label: 'Category' })),
    note: s.optional(s.string({ label: 'Note' })),
    savedOn: s.optional(s.isoDate()),
    applicationId,
  }),

  run(ctx, input) {
    ctx.require('link', input.id)
    ctx.tx.patch<'link'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.url === undefined ? {} : { url: input.url.trim() }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
      ...(input.savedOn === undefined ? {} : { savedOn: input.savedOn }),
    })
    fileUnder(ctx, input.id, input.applicationId)
  },

  describe: (input, _output, m) => ({
    title: 'Link saved',
    description: m.node(input.id, 'link')?.props.title ?? '',
  }),
})

export const vaultLinkDelete = defineTool({
  name: 'vault.link.delete',
  title: 'Delete link',
  summary: 'Removes the link from the Vault.',
  effect: 'delete',
  touches: ['link'],
  input: s.object({ id: linkId }),

  run(ctx, input) {
    ctx.require('link', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Link removed',
    description: m.node(input.id, 'link')?.props.title ?? '',
    tone: 'danger',
  }),
})

export const vaultLinkDuplicate = defineTool({
  name: 'vault.link.duplicate',
  title: 'Duplicate link',
  summary: 'Copies the link, keeping its category and where it is filed.',
  effect: 'create',
  touches: ['link'],
  input: s.object({ id: linkId }),

  run(ctx, input): NodeId {
    const source = ctx.require('link', input.id)
    const id = ctx.newId('link')
    ctx.tx.put({
      id,
      type: 'link',
      props: { ...source.props, slug: ctx.mintSlug('link', source.props.title) },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    const under = ctx.memory.one(input.id, 'FILED_UNDER', 'application')
    if (under) ctx.tx.link(id, 'FILED_UNDER', under.id)
    return id
  },

  describe: (_input, id, m) => ({
    title: 'Link duplicated',
    description: m.node(id, 'link')?.props.title ?? '',
  }),
})

export const vaultLinkRecategorise = defineTool({
  name: 'vault.link.recategorise',
  title: 'Move link',
  summary: 'Files the link under a different category.',
  effect: 'move',
  touches: ['link'],
  input: s.object({ id: linkId, category: s.enum(LINK_CATEGORY_VALUES, { label: 'Category' }) }),

  run(ctx, input) {
    ctx.require('link', input.id)
    ctx.tx.patch<'link'>(input.id, { category: input.category })
  },

  describe: (input) => ({ title: `Moved to ${input.category}` }),
})

/* ---------------------------------- files --------------------------------- */

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
  applicationId: s.optional(s.nullable(s.id('application'))),
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
          ...opt('note', cleared(draft.note)),
        },
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      fileUnder(ctx, id, draft.applicationId)
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
    size: s.optional(s.string({ label: 'Size' })),
    savedOn: s.optional(s.isoDate()),
    applicationId,
  }),

  run(ctx, input) {
    ctx.require('file', input.id)
    ctx.tx.patch<'file'>(input.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.savedOn === undefined ? {} : { savedOn: input.savedOn }),
    })
    fileUnder(ctx, input.id, input.applicationId)
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
    ctx.require('file', input.id)
    ctx.tx.patch<'file'>(input.id, { note: cleared(input.note) })
  },

  describe: (input) => ({ title: input.note.trim() ? 'Note saved' : 'Note cleared' }),
})

/* -------------------------------- snippets -------------------------------- */

const snippetId = s.id('snippet', { label: 'Snippet' })

export const vaultSnippetCreate = defineTool({
  name: 'vault.snippet.create',
  title: 'Add snippet',
  summary: 'Saves an answer you would otherwise retype on every form.',
  effect: 'create',
  touches: ['snippet'],
  input: s.object({
    title: s.string({ min: 1, label: 'Title' }),
    tag: s.enum(SNIPPET_TAG_VALUES, { label: 'Used for' }),
    body: s.string({ label: 'Text', multiline: true }),
    applicationId,
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('snippet')
    ctx.tx.put({
      id,
      type: 'snippet',
      props: {
        slug: ctx.mintSlug('snippet', input.title),
        title: input.title.trim(),
        tag: input.tag,
        body: input.body,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    fileUnder(ctx, id, input.applicationId)
    return id
  },

  describe: (input) => ({ title: 'Snippet saved', description: input.title.trim() }),
})

export const vaultSnippetUpdate = defineTool({
  name: 'vault.snippet.update',
  title: 'Edit snippet',
  summary: 'Saves the snippet’s title, tag and text.',
  effect: 'update',
  touches: ['snippet'],
  input: s.object({
    id: snippetId,
    title: s.optional(s.string({ min: 1, label: 'Title' })),
    tag: s.optional(s.enum(SNIPPET_TAG_VALUES, { label: 'Used for' })),
    body: s.optional(s.string({ label: 'Text', multiline: true })),
    applicationId,
  }),

  run(ctx, input) {
    ctx.require('snippet', input.id)
    ctx.tx.patch<'snippet'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
      ...(input.body === undefined ? {} : { body: input.body }),
    })
    fileUnder(ctx, input.id, input.applicationId)
  },

  describe: (input, _output, m) => ({
    title: 'Snippet saved',
    description: m.node(input.id, 'snippet')?.props.title ?? '',
  }),
})

export const vaultSnippetDelete = defineTool({
  name: 'vault.snippet.delete',
  title: 'Delete snippet',
  summary: 'Removes the snippet from the Vault.',
  effect: 'delete',
  touches: ['snippet'],
  input: s.object({ id: snippetId }),

  run(ctx, input) {
    ctx.require('snippet', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Snippet removed',
    description: m.node(input.id, 'snippet')?.props.title ?? '',
    tone: 'danger',
  }),
})

export const vaultSnippetDuplicate = defineTool({
  name: 'vault.snippet.duplicate',
  title: 'Duplicate snippet',
  summary: 'Copies the snippet so a variant can be written without losing the original.',
  effect: 'create',
  touches: ['snippet'],
  input: s.object({ id: snippetId }),

  run(ctx, input): NodeId {
    const source = ctx.require('snippet', input.id)
    const id = ctx.newId('snippet')
    ctx.tx.put({
      id,
      type: 'snippet',
      props: { ...source.props, slug: ctx.mintSlug('snippet', source.props.title) },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    const under = ctx.memory.one(input.id, 'FILED_UNDER', 'application')
    if (under) ctx.tx.link(id, 'FILED_UNDER', under.id)
    return id
  },

  describe: (_input, id, m) => ({
    title: 'Snippet duplicated',
    description: m.node(id, 'snippet')?.props.title ?? '',
  }),
})

export const vaultSnippetRetag = defineTool({
  name: 'vault.snippet.retag',
  title: 'Change what a snippet is for',
  summary: 'Moves the snippet to another tag.',
  effect: 'move',
  touches: ['snippet'],
  input: s.object({ id: snippetId, tag: s.enum(SNIPPET_TAG_VALUES, { label: 'Used for' }) }),

  run(ctx, input) {
    ctx.require('snippet', input.id)
    ctx.tx.patch<'snippet'>(input.id, { tag: input.tag })
  },

  describe: (input) => ({ title: `Moved to ${input.tag}` }),
})
