/**
 * Keeping a document a model tailored for one posting. L3.
 *
 * One write. It is its own tool rather than an optional field on
 * `vault.snippet.create` for the reason `fit.reading.set` is its own tool: the
 * provenance it stamps is what the tailoring card trusts to say "a model wrote
 * this, from that document, for this job", and `vault.snippet.create` is on
 * the twin pipeline's allowlist — a background round could otherwise mint a
 * snippet that claimed to be tailored without anyone having asked. This one is
 * off the palette and off every pipeline allowlist. The assistant and the MCP
 * link can still reach it, as they reach every registered tool — and that is
 * fine, because in both cases a person is asking for it in so many words. What
 * cannot happen is a timer writing one.
 *
 * It IS on the undo ring, unlike `fit.reading.set`. Somebody pressed a button
 * and a document appeared; "Tailored CV saved · Undo" is exactly what they
 * should see, and ⌘Z afterwards should take it back.
 *
 * `source` is a breadcrumb and not `s.id('file')`. The document existed when
 * the read started and may not when the reply lands — a person can delete a
 * file while a model thinks — and refusing the tailored text because its
 * origin is gone would throw away a minute of generation over a bookkeeping
 * detail. The snippet is theirs; the breadcrumb just says where it came from.
 */

import { PROFILE_DOCUMENTS, SNIPPET_TAG_VALUES } from '../core/model'
import type { NodeId, TailoredFrom } from '../core/model'
import { DOCUMENT_LABEL } from '../core/document-kind'
import { s } from '../core/schema'
import { displayOf } from './support'
import { defineTool } from './tool'

export const tailorSnippetCreate = defineTool({
  name: 'tailor.snippet.create',
  title: 'Save a tailored document',
  summary:
    'Files a document a model tailored for one posting as a snippet under that application, with the document it came from, the model and the time written on it.',
  effect: 'create',
  touches: ['snippet'],
  /*
   * Off the palette. Nobody types a tailored CV into a command; the card that
   * read the document and asked the model is the only caller that has one.
   */
  internal: true,
  input: s.object({
    applicationId: s.id('application', { label: 'Application' }),
    source: s.string({ min: 1, label: 'Tailored from' }),
    kind: s.enum(PROFILE_DOCUMENTS, { label: 'Document kind' }),
    model: s.string({ min: 1, label: 'Written by' }),
    title: s.string({ min: 1, label: 'Title' }),
    tag: s.enum(SNIPPET_TAG_VALUES, { label: 'Used for' }),
    body: s.string({ min: 1, label: 'Text', multiline: true }),
  }),

  run(ctx, input): NodeId {
    ctx.require('application', input.applicationId)
    const id = ctx.newId('snippet')
    // Rebuilt field by field, never spread from the input — `s.object` keeps
    // unknown keys, and this is a prop.
    const tailored: TailoredFrom = {
      source: input.source,
      kind: input.kind,
      model: input.model,
      at: ctx.now,
    }
    ctx.tx.put({
      id,
      type: 'snippet',
      props: {
        slug: ctx.mintSlug('snippet', input.title),
        title: input.title.trim(),
        tag: input.tag,
        body: input.body,
        tailored,
      },
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    ctx.tx.link(id, 'FILED_UNDER', input.applicationId)
    return id
  },

  describe: (input, _output, m) => ({
    title: `Tailored ${DOCUMENT_LABEL[input.kind]} saved`,
    description: `Filed under ${displayOf(m, input.applicationId)}.`,
  }),
})
