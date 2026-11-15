/**
 * Owner request Q220: the tool list a run is offered keeps the order it was given.
 *
 * `toolsFor` used to filter `functionSpecs()`, so whatever order a caller chose
 * came back in catalog order. The order of the tool block is what a KV prefix
 * cache keys on — a tool inserted mid-block invalidates every token after it —
 * so it has to be the caller's to decide. Asserted through `offerFor`, the
 * exported seam `toolsFor` sits behind.
 */

import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { offerFor } from './offer'
import type { AgentOptions } from './types'

const options = (tools: readonly string[]): AgentOptions =>
  ({
    host: {} as AgentOptions['host'],
    llm: (() => Promise.reject(new Error('not called'))) as AgentOptions['llm'],
    history: [],
    prompt: 'x',
    onEvent: () => {},
    tools,
  }) as AgentOptions

const wire = (name: string) => CATALOG.find((e) => e.name === name)!.wireName

describe('the order of an offered tool list', () => {
  it('comes back in the order the caller asked for, not catalog order', () => {
    // Deliberately against catalog order: the catalog puts reads first.
    const asked = ['timeline.item.delete', 'application.create', 'memory.search']
    const catalogOrder = CATALOG.map((e) => e.name).filter((n) => asked.includes(n))
    expect(catalogOrder).not.toEqual(asked)

    const offered = offerFor(options(asked), null)
    expect(offered.tools.map((t) => t.function.name)).toEqual(asked.map(wire))
  })

  it('emits each tool once, whichever spelling the caller used for it', () => {
    const offered = offerFor(
      options(['application.create', wire('application.create'), 'memory.search']),
      null,
    )
    expect(offered.tools.map((t) => t.function.name)).toEqual(
      ['application.create', 'memory.search'].map(wire),
    )
  })
})
