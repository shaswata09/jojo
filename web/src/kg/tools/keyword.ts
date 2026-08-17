/**
 * L3 — the keyword tools.
 *
 * D14, and the wave's first end-to-end proof that edges journal correctly. A
 * keyword is a node and tagging is a `TAGS` edge, which deletes the whole class
 * of bug documented at the removed `store-context.ts`: keywords lived in a provider
 * above the store, so every write that touched records had to carry the keyword
 * map by hand. Fifteen stash sites did; the ones that did not left edges
 * outliving the records they pointed at, and a cleared store still reported
 * "Used on 32 records" in Settings while the Applications filter, counting within
 * a live list, read 0 for the same keyword on the same screenful.
 *
 * `removeLabel`'s hand-rolled three-part undo (in the old `labels.tsx`) is gone with
 * it. It is now the same generic undo as everything else, and the trap it
 * documented — a filter selection holding an id nothing carries, which empties
 * every list on the page with no chip left to explain it — belongs to the filter
 * selection, which is UI state and stays in `labels.tsx`.
 */

import type { LabelTone, NodeId, Taggable } from '@/kg/core/model'
import { LABEL_TONE_VALUES, TAGGABLE } from '@/kg/core/model'
import { s } from '@/kg/core/schema'
import { defineTool } from './tool'
import type { ToolContext } from './tool'

/**
 * The colour a keyword the user creates gets, cycled so two in a row differ.
 *
 * It was declared in `src/data/labels.ts` beside the seeded keywords, which made
 * this tool — the only caller it has ever had — import a fixture module to mint a
 * colour. `src/data` is read by `repo/seed.ts` and `tools/memory.ts` and by
 * nothing else in the layer now; the rule for which tone a NEW keyword gets is a
 * tool's rule, so it lives with the tool that applies it.
 */
const NEW_KEYWORD_TONES: LabelTone[] = ['teal', 'green', 'amber', 'red', 'gray']

const keywordId = s.id('keyword', { label: 'Keyword' })

/** Anything a keyword may sit on. `s.id()` with no type, checked against TAGGABLE. */
const recordId = s.id(undefined, { label: 'Record' })

const TAGGABLE_SET: ReadonlySet<string> = new Set<string>(TAGGABLE)

function requireTaggable(ctx: ToolContext, id: NodeId) {
  const node = ctx.memory.node(id)
  if (!node) ctx.fail('That record is no longer here.', { code: 'graph/not-found' })
  if (!TAGGABLE_SET.has(node.type)) {
    ctx.fail('Keywords do not go on that kind of record.', { code: 'graph/invariant' })
  }
  return node as { id: NodeId; type: Taggable }
}

/** The snapshot keeps a folded-name index precisely so this is not a scan. */
const byFoldedName = (ctx: ToolContext, name: string) => ctx.memory.keywordNamed(name)

export const keywordCreate = defineTool({
  name: 'keyword.create',
  title: 'Add keyword',
  summary: 'Creates a keyword, or hands back the one that already has this name.',
  effect: 'create',
  touches: ['keyword'],
  input: s.object({
    name: s.string({ min: 1, max: 40, label: 'Name' }),
    tone: s.optional(s.enum(LABEL_TONE_VALUES, { label: 'Colour' })),
  }),

  run(ctx, input): NodeId {
    const name = input.name.trim()
    // Folded name, not slug: after a rename an id says nothing about what the
    // keyword is called — 'developr' can legitimately read "Developer" — so a
    // slug match misses it and mints a twin.
    const existing = byFoldedName(ctx, name)
    if (existing) return existing.id

    const id = ctx.newId('keyword')
    const taken = ctx.memory.ofType('keyword').length
    ctx.tx.put({
      id,
      type: 'keyword',
      props: {
        slug: ctx.mintSlug('keyword', name),
        name,
        tone: input.tone ?? NEW_KEYWORD_TONES[taken % NEW_KEYWORD_TONES.length] ?? 'teal',
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    return id
  },

  describe: (input) => ({ title: `${input.name.trim()} added` }),
})

export const keywordRename = defineTool({
  name: 'keyword.rename',
  title: 'Rename keyword',
  summary: 'Changes what the keyword is called, everywhere it is used.',
  effect: 'update',
  touches: ['keyword'],
  input: s.object({ id: keywordId, name: s.string({ min: 1, max: 40, label: 'Name' }) }),

  run(ctx, input) {
    ctx.require('keyword', input.id)
    const name = input.name.trim()
    const clash = byFoldedName(ctx, name)
    // Refused rather than merged: two chips reading the same word are
    // indistinguishable, and merging would quietly rewrite every record carrying
    // either one with no way back.
    if (clash && clash.id !== input.id) {
      ctx.fail(`There is already a keyword called ${clash.props.name}.`, { field: 'name' })
    }
    // The slug is NOT re-minted. It is no longer identity, but it is read in
    // exports and in the URL, and rewriting it on every rename would break links
    // someone had already saved.
    ctx.tx.patch<'keyword'>(input.id, { name })
  },

  describe: (input) => ({ title: `Renamed to ${input.name.trim()}` }),
})

export const keywordDelete = defineTool({
  name: 'keyword.delete',
  title: 'Delete keyword',
  summary: 'Removes the keyword and takes it off every record carrying it.',
  effect: 'delete',
  touches: ['keyword'],
  input: s.object({ id: keywordId }),

  run(ctx, input) {
    ctx.require('keyword', input.id)
    // The TAGS edges go with the node; the records at the other end do not.
    ctx.tx.del(input.id)
  },

  describe: (input, _output, m) => ({
    title: `${m.node(input.id, 'keyword')?.props.name ?? 'Keyword'} deleted`,
    tone: 'danger',
  }),
})

export const keywordToneSet = defineTool({
  name: 'keyword.tone.set',
  title: 'Recolour keyword',
  summary: 'Changes the keyword’s chip colour.',
  effect: 'update',
  touches: ['keyword'],
  input: s.object({ id: keywordId, tone: s.enum(LABEL_TONE_VALUES, { label: 'Colour' }) }),

  run(ctx, input) {
    ctx.require('keyword', input.id)
    ctx.tx.patch<'keyword'>(input.id, { tone: input.tone })
  },

  describe: (_input, _output) => ({ title: 'Colour changed' }),
})

/* --------------------------------- tagging -------------------------------- */

export const keywordAttach = defineTool({
  name: 'keyword.attach',
  title: 'Add keyword to a record',
  summary: 'Tags one record with one keyword.',
  effect: 'update',
  touches: ['keyword', ...TAGGABLE],
  input: s.object({ record: recordId, keyword: keywordId }),

  run(ctx, input) {
    requireTaggable(ctx, input.record)
    ctx.require('keyword', input.keyword)
    // Idempotent: the edge id IS the triple, so tagging twice writes one edge.
    ctx.tx.link(input.keyword, 'TAGS', input.record)
  },

  describe: (input, _output, m) => ({
    title: `${m.node(input.keyword, 'keyword')?.props.name ?? 'Keyword'} added`,
  }),
})

export const keywordDetach = defineTool({
  name: 'keyword.detach',
  title: 'Remove keyword from a record',
  summary: 'Takes one keyword off one record. The keyword itself stays.',
  effect: 'update',
  touches: ['keyword', ...TAGGABLE],
  input: s.object({ record: recordId, keyword: keywordId }),

  run(ctx, input) {
    ctx.tx.unlink(input.keyword, 'TAGS', input.record)
  },

  describe: (input, _output, m) => ({
    title: `${m.node(input.keyword, 'keyword')?.props.name ?? 'Keyword'} removed`,
  }),
})

/**
 * The whole keyword set on one record, for a dialog save.
 *
 * A set rather than a diff, because that is what the form holds: the picker
 * knows which chips are on and nothing else. Computing the difference here is
 * what makes it one commit — the dialog used to call `setRecord`, which replaced
 * the record's entry in a flat map and therefore could not journal an edge at
 * all.
 */
export const keywordRecordSet = defineTool({
  name: 'keyword.record.set',
  title: 'Set a record’s keywords',
  summary: 'Replaces every keyword on one record with the ones given.',
  effect: 'update',
  touches: [...TAGGABLE],
  input: s.object({
    record: recordId,
    keywords: s.array(s.id('keyword'), { label: 'Keywords' }),
  }),

  run(ctx, input) {
    requireTaggable(ctx, input.record)
    const wanted = new Set(input.keywords)

    for (const edge of ctx.memory.in(input.record, 'TAGS')) {
      if (!wanted.has(edge.from)) ctx.tx.unlink(edge.from, 'TAGS', input.record)
    }
    for (const keyword of wanted) {
      ctx.require('keyword', keyword)
      ctx.tx.link(keyword, 'TAGS', input.record)
    }
  },

  describe: (input) => ({
    title:
      input.keywords.length === 0
        ? 'Keywords cleared'
        : `${input.keywords.length} keyword${input.keywords.length === 1 ? '' : 's'} set`,
  }),
})
