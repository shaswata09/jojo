/**
 * L3 — the vault's link tools. The filing rules all four vault
 * files share are in `vault-shared.ts`.
 */

import { LINK_CATEGORY_VALUES } from '../core/model'
import type { NodeId } from '../core/model'
import { s } from '../core/schema'
import { defineTool } from './tool'
import { dayOf, opt } from './support'
import { applicationIds, cleared, fileUnder } from './vault-shared'

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
