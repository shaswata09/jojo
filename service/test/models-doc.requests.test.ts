/**
 * docs/MODELS.md is the tutorial for connecting a model and the document reader
 * (Q339). A tutorial that names an endpoint the app no longer uses, or a reader
 * command the Settings card no longer copies, sends somebody down a path that
 * fails with a connection error, which reads like their mistake. So the doc is
 * held to the same sources the app itself reads: the provider catalogue and the
 * MarkItDown constants.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '../kg/core/provider'
import { MARKITDOWN } from '../kg/agent/markitdown'

const doc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'MODELS.md'), 'utf8')

describe('the model and reader tutorial (Q339)', () => {
  it('names every provider in the catalogue by the label the Provider menu shows', () => {
    for (const provider of PROVIDERS) expect(doc, provider.id).toContain(provider.label)
  })

  it('gives each local provider’s default address and each cloud provider’s key page', () => {
    for (const provider of PROVIDERS) {
      if (provider.endpoint && !provider.fixedEndpoint)
        expect(doc, provider.id).toContain(provider.endpoint)
      if (provider.keyUrl) expect(doc, provider.id).toContain(provider.keyUrl)
    }
  })

  it('carries the reader commands the Settings card copies, and its address', () => {
    expect(doc).toContain(MARKITDOWN.install)
    expect(doc).toContain(MARKITDOWN.serve)
    expect(doc).toContain(MARKITDOWN.defaultEndpoint)
    expect(doc).toContain('/reader/mcp')
  })

  it('tells a vLLM user the flags without which the assistant cannot call a tool', () => {
    expect(doc).toContain('--enable-auto-tool-choice --tool-call-parser')
  })
})
