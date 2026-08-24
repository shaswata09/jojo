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
/**
 * The applications a record is filed under, as a SET.
 *
 * A list, since `FILED_UNDER` became `fromCardinality: 'many'`. Absent means
 * "leave the filing alone" and an empty list means "file it under nothing",
 * which are different instructions — renaming a link must not unfile it.
 */
const applicationIds = s.optional(
  s.nullable(s.array(s.id('application'), { label: 'Filed under' })),
)

const cleared = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() || undefined

/**
 * Files a record under exactly the applications given.
 *
 * A SET operation, not an add: the whole list replaces whatever was there, so a
 * caller passing three ids gets three edges and passing two of the same three
 * drops the one it left out. `FILED_UNDER` is `fromCardinality: 'many'` now, so
 * `tx.link` no longer displaces the previous edge on its own — the `unlinkAll`
 * is what makes this a set rather than an ever-growing pile.
 *
 * Absent still means "leave it where it is", or renaming a link would unfile it
 * from every application it was saved against.
 */
function fileUnder(ctx: ToolContext, id: NodeId, appIds: readonly NodeId[] | null | undefined) {
  if (appIds === undefined) return
  ctx.tx.unlinkAll(id, { rel: 'FILED_UNDER' })
  if (appIds === null) return
  for (const appId of appIds) ctx.tx.link(id, 'FILED_UNDER', appId)
}

/* --------------------------------- people --------------------------------- */

const personId = s.id('person', { label: 'Person' })

/**
 * The optional half of a person, in one place.
 *
 * Everything except the name is optional, and `cleared` above is what makes an
 * emptied field actually empty rather than a stored `''` — a note wiped in the
 * form has to leave the record, or the Vault goes on rendering a blank line
 * under the name forever.
 */
const personDetails = {
  role: s.optional(s.string({ label: 'Role' })),
  affiliation: s.optional(s.string({ label: 'Affiliation' })),
  email: s.optional(s.string({ label: 'Email' })),
  phone: s.optional(s.string({ label: 'Phone' })),
  note: s.optional(s.string({ label: 'Note', multiline: true })),
}

export const vaultPersonCreate = defineTool({
  name: 'vault.person.create',
  title: 'Add person',
  summary: 'Remembers someone in the search — a referee, a chair, a recruiter.',
  effect: 'create',
  touches: ['person'],
  input: s.object({
    name: s.string({ min: 1, label: 'Name' }),
    ...personDetails,
    applicationIds,
  }),

  run(ctx, input): NodeId {
    const id = ctx.newId('person')
    // Bound before the spread rather than called inside it: under
    // `exactOptionalPropertyTypes` a property whose value is `string |
    // undefined` is not the same type as an absent one, and only the binding
    // narrows it. A blank field has to be ABSENT, not stored as '', or the
    // Vault renders an empty line under the name for ever.
    const role = cleared(input.role)
    const affiliation = cleared(input.affiliation)
    const email = cleared(input.email)
    const phone = cleared(input.phone)
    const note = cleared(input.note)
    ctx.tx.put({
      id,
      type: 'person',
      props: {
        slug: ctx.mintSlug('person', input.name),
        name: input.name.trim(),
        ...(role === undefined ? {} : { role }),
        ...(affiliation === undefined ? {} : { affiliation }),
        ...(email === undefined ? {} : { email }),
        ...(phone === undefined ? {} : { phone }),
        ...(note === undefined ? {} : { note }),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    fileUnder(ctx, id, input.applicationIds)
    return id
  },

  describe: (input) => ({ title: 'Person saved', description: input.name.trim() }),
})

export const vaultPersonUpdate = defineTool({
  name: 'vault.person.update',
  title: 'Edit person',
  summary: 'Saves what you know about them, and which jobs they are named on.',
  effect: 'update',
  touches: ['person'],
  input: s.object({
    id: personId,
    name: s.optional(s.string({ min: 1, label: 'Name' })),
    ...personDetails,
    applicationIds,
  }),

  run(ctx, input) {
    ctx.require('person', input.id)
    ctx.tx.patch<'person'>(input.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.role === undefined ? {} : { role: cleared(input.role) }),
      ...(input.affiliation === undefined ? {} : { affiliation: cleared(input.affiliation) }),
      ...(input.email === undefined ? {} : { email: cleared(input.email) }),
      ...(input.phone === undefined ? {} : { phone: cleared(input.phone) }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
    })
    fileUnder(ctx, input.id, input.applicationIds)
  },

  describe: (input, _output, m) => ({
    title: 'Person saved',
    description: m.node(input.id, 'person')?.props.name ?? '',
  }),
})

export const vaultPersonDelete = defineTool({
  name: 'vault.person.delete',
  title: 'Remove person',
  summary: 'Removes them from the Vault. The jobs they were named on are untouched.',
  effect: 'delete',
  touches: ['person'],
  input: s.object({ id: personId }),

  run(ctx, input) {
    ctx.require('person', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: 'Person removed',
    description: m.node(input.id, 'person')?.props.name ?? '',
    tone: 'danger',
  }),
})

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
    applicationIds,
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
    fileUnder(ctx, id, input.applicationIds)
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
    applicationIds,
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
    fileUnder(ctx, input.id, input.applicationIds)
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
  summary: 'Copies the link, keeping its category and every application it is filed under.',
  effect: 'create',
  touches: ['link'],
  input: s.object({ id: linkId }),

  run(ctx, input): NodeId {
    const source = ctx.require('link', input.id)
    const id = ctx.newId('link')
    ctx.tx.put({
      id,
      type: 'link',
      /*
       * Filed NOW, not when the original was.
       *
       * `...source.props` carried the source's `savedOn` across, so the copy
       * took the original's filing date. That was invisible while the Vault
       * listed links oldest-first — every new record went to the bottom either
       * way — and it is a full list apart now that the newest is at the top:
       * the copy would appear next to its original, halfway down, while the
       * toast announcing it offered an Undo for something off screen.
       *
       * The row menus on both platforms already do it this way: they re-save
       * through `addLink` without a `savedOn`, so it defaults to today. This is
       * the two paths agreeing rather than a new rule.
       */
      props: {
        ...source.props,
        savedOn: dayOf(ctx.now),
        slug: ctx.mintSlug('link', source.props.title),
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    // EVERY filing, not the first. `FILED_UNDER` is `fromCardinality: 'many'`,
    // and `memory.one` answers with whichever edge it reaches first without
    // mentioning the others — so a CV filed under three applications duplicated
    // to a copy filed under one, and nothing said so.
    for (const under of ctx.memory.many(input.id, 'FILED_UNDER', 'out', 'application')) {
      ctx.tx.link(id, 'FILED_UNDER', under.id)
    }
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
    ctx.require('file', input.id)
    ctx.tx.patch<'file'>(input.id, {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
      ...(input.note === undefined ? {} : { note: cleared(input.note) }),
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.uri === undefined ? {} : { uri: input.uri }),
      ...(input.savedOn === undefined ? {} : { savedOn: input.savedOn }),
    })
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
    applicationIds,
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
    fileUnder(ctx, id, input.applicationIds)
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
    applicationIds,
  }),

  run(ctx, input) {
    ctx.require('snippet', input.id)
    ctx.tx.patch<'snippet'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
      ...(input.body === undefined ? {} : { body: input.body }),
    })
    fileUnder(ctx, input.id, input.applicationIds)
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
      // No `savedOn` to restamp — a snippet carries no date at all, so the id
      // minted just above is what puts the copy at the top of the list. See the
      // note on the link duplicate above for why that matters.
      props: { ...source.props, slug: ctx.mintSlug('snippet', source.props.title) },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    // EVERY filing, not the first. `FILED_UNDER` is `fromCardinality: 'many'`,
    // and `memory.one` answers with whichever edge it reaches first without
    // mentioning the others — so a CV filed under three applications duplicated
    // to a copy filed under one, and nothing said so.
    for (const under of ctx.memory.many(input.id, 'FILED_UNDER', 'out', 'application')) {
      ctx.tx.link(id, 'FILED_UNDER', under.id)
    }
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
