/**
 * L3 — the vault's snippet tools: reusable text for forms. The filing rules all
 * four vault files share are in `vault-shared.ts`.
 */

import { stripMarks } from '../core/marks'
import { decodeFormat, normaliseFormat, retextFormat } from '../core/note-format'
import { SNIPPET_TAG_VALUES } from '../core/model'
import type { NodeId } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import { opt } from './support'
import { applicationIds, fileUnder } from './vault-shared'

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
    /** Written by the snippet editor. See `vault.file.update`'s, which it mirrors. */
    format: s.optional(
      s.string({
        label: 'Text formatting',
        description: 'Written by the snippet editor. Leave this out; the text is stored plain.',
      }),
    ),
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
        // `opt`, so a snippet saved without formatting is byte-identical to one
        // that never had any — the rule `normaliseFormat` keeps for `[]`.
        ...opt('bodyFormat', normaliseFormat(input.body, decodeFormat(input.format))),
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
    /** Written by the snippet editor. See `vault.file.update`'s, which it mirrors. */
    format: s.optional(
      s.string({
        label: 'Text formatting',
        description: 'Written by the snippet editor. Leave this out; the existing formatting is kept.',
      }),
    ),
    applicationIds,
  }),

  run(ctx, input) {
    const current = ctx.require('snippet', input.id)
    ctx.tx.patch<'snippet'>(input.id, {
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
      ...(input.body === undefined ? {} : { body: input.body }),
      // The same three cases as the file note (`vault-files.ts`): given spans, canonicalise;
      // given only new text, move what is there onto it; given neither, write
      // nothing.
      ...(input.format !== undefined
        ? {
            bodyFormat: normaliseFormat(
              input.body ?? current.props.body,
              decodeFormat(input.format),
            ),
          }
        : input.body === undefined
          ? {}
          : {
              bodyFormat: retextFormat(current.props.body, input.body, current.props.bodyFormat),
            }),
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
  /**
   * `title` so the copy can be named in the SAME write.
   *
   * Both apps put "(copy)" on the end, and doing that with a follow-up
   * `vault.snippet.update` made one button press two journal entries: a single
   * ⌘Z then took the rename back and left a copy carrying the original's exact
   * title, beside the original, which is the confusion Duplicate exists to
   * avoid. Optional, because the agent has no reason to rename what it copies.
   */
  input: s.object({ id: snippetId, title: s.optional(s.string({ min: 1, label: 'Title' })) }),

  run(ctx, input): NodeId {
    const source = ctx.require('snippet', input.id)
    const id = ctx.newId('snippet')
    // Everything but `tailored`. A copy the person made is not the model's
    // output, and a duplicate that kept the provenance would show up on the
    // application's tailoring card claiming a model wrote it.
    const { tailored: _tailored, bodyFormat, ...rest } = source.props
    // And without the marks, for the same reason from the other side: a body is
    // only ever READ as marked when its record says a model wrote it, so a copy
    // that kept `**` and `##` would show them as typed. The spans move with the
    // text — stripping marks shifts every offset, and the copy's bold used to
    // land on the wrong characters.
    const body = source.props.tailored === undefined ? source.props.body : stripMarks(source.props.body)
    const format = body === source.props.body ? bodyFormat : retextFormat(source.props.body, body, bodyFormat)
    ctx.tx.put({
      id,
      type: 'snippet',
      // No `savedOn` to restamp — a snippet carries no date at all, so the id
      // minted just above is what puts the copy at the top of the list. See the
      // note on the link duplicate in `vault-links.ts` for why that matters.
      props: {
        ...rest,
        body,
        ...opt('bodyFormat', format),
        ...(input.title === undefined ? {} : { title: input.title }),
        slug: ctx.mintSlug('snippet', input.title ?? source.props.title),
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
