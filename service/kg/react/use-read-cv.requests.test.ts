/**
 * Q245: "Gemma does not call the tools to update the profile — how does a
 * person update an existing one?"
 *
 * The answer is the profile update offer: the person picks a document (the
 * Profile's "Read a document", the Vault's "Read into your profile" —
 * `profile-read-request.test.ts`, and `core/twin.test.ts` for which documents
 * may be chosen), the reader turns it into entries, and the person confirms
 * them. For that to complete on a model that calls tools poorly, the reader must
 * never NEED a tool call: every turn it takes offers the model no tools and
 * reads its plain-text answer, and the write is made by the app on confirm.
 *
 * `readCvWith` is the reader behind `useReadCv`, driven here with a model that
 * only ever answers in text.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ModelSettings } from '../core/provider'
import type { Turn } from '../core/model-server-turn'
import { readCvWith } from './use-read-cv'

const MODEL: ModelSettings = { provider: 'ollama', endpoint: 'http://model.test', model: 'gemma3' }

const CV = [
  '# Alex Rivera',
  '',
  '## Education',
  '- PhD, Computer Science, University of Illinois, 2016–2021',
  '',
  '## Experience',
  '- Research scientist, Acme Labs, 2021–2024: built retrieval systems for scientific text.',
  '',
  '## Skills',
  '- Rust, Python, information retrieval',
].join('\n')

const ENTRIES = {
  background: [
    { kind: 'education', title: 'PhD, Computer Science', where: 'University of Illinois', year: 2016 },
    { kind: 'employment', title: 'Research scientist', where: 'Acme Labs', year: 2021 },
    { kind: 'skill', title: 'Rust' },
  ],
}

/** A model that never calls a tool: it answers every turn with text. */
function textOnlyModel() {
  return vi.fn(
    async (): Promise<Turn> => ({
      ok: true,
      text: JSON.stringify(ENTRIES),
      toolCalls: [],
      finishReason: 'stop',
    }),
  )
}

describe('Q245 — reading a document into the profile needs no tool calls', () => {
  it('completes against a model that only answers in text', async () => {
    const turn = textOnlyModel()
    const read = readCvWith({
      turn,
      readDocument: async () => ({ ok: true, markdown: CV }),
    })
    const outcome = await read({ fileId: 'file:cv', name: 'CV.pdf', settings: MODEL })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.background.map((b) => b.title)).toEqual(
      expect.arrayContaining(['PhD, Computer Science', 'Research scientist', 'Rust']),
    )
  })

  it('offers the model no tools on any turn it takes', async () => {
    const turn = textOnlyModel()
    await readCvWith({ turn, readDocument: async () => ({ ok: true, markdown: CV }) })({
      fileId: 'file:cv',
      name: 'CV.pdf',
      settings: MODEL,
    })

    expect(turn.mock.calls.length).toBeGreaterThan(0)
    for (const call of turn.mock.calls as unknown as unknown[][]) expect(call[2]).toEqual([])
  })
})
