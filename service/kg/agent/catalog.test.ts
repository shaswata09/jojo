import { describe, expect, it } from 'vitest'
import { TOOLS } from '../tools/index'
import { CATALOG, describeEntry, entryForWire, functionSpecs, mcpSpecs, toWireName } from './catalog'
import { READS } from './queries'

describe('coverage', () => {
  it('exposes every tool in the registry, plus every read', () => {
    // The claim the whole feature rests on: a tool the app can run is a tool a
    // model can call. A count is what makes adding a tool and forgetting the
    // catalog a failing test rather than a silent gap.
    expect(CATALOG).toHaveLength(Object.keys(TOOLS).length + Object.keys(READS).length)
    for (const name of Object.keys(TOOLS)) {
      expect(CATALOG.some((e) => e.name === name)).toBe(true)
    }
  })

  it('hides nothing, including the tools marked internal', () => {
    // `Tool.internal` means "hidden from the palette", which is a claim about
    // screen space and not about safety.
    const internal = Object.values(TOOLS).filter((t) => t.internal)
    expect(internal.length).toBeGreaterThan(0)
    for (const t of internal) expect(CATALOG.some((e) => e.name === t.name)).toBe(true)
  })

  it('puts the reads first, where a model’s attention is', () => {
    // Nearly every correct plan starts with a read: you cannot advance a stage
    // without an id.
    expect(CATALOG.slice(0, 5).every((e) => e.effect === 'read')).toBe(true)
  })
})

describe('the name problem', () => {
  it('transliterates dots, because OpenAI function names forbid them', () => {
    expect(toWireName('application.stage.advance')).toBe('application_stage_advance')
  })

  it('round-trips every name in the registry with no collisions', () => {
    // A tool named `foo_bar.baz` would collide with `foo.bar.baz`, and the two
    // would be indistinguishable on the wire — a silent misroute, not an error.
    const wire = new Set(CATALOG.map((e) => e.wireName))
    expect(wire.size).toBe(CATALOG.length)
    for (const entry of CATALOG) {
      expect(entryForWire(entry.wireName)?.name).toBe(entry.name)
    }
  })

  it('produces names every OpenAI-compatible server will accept', () => {
    for (const spec of functionSpecs()) {
      expect(spec.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    }
  })
})

describe('destructiveness', () => {
  it('marks delete and admin, and nothing else', () => {
    const destructive = CATALOG.filter((e) => e.destructive)
    expect(destructive.every((e) => e.effect === 'delete' || e.effect === 'admin')).toBe(true)
    expect(destructive.some((e) => e.name === 'application.delete')).toBe(true)
    expect(CATALOG.find((e) => e.name === 'application.create')?.destructive).toBe(false)
  })

  it('singles out the two operations a user could not undo', () => {
    // `memory.reset` and `memory.clear` carry `undoable: false`, so they are the
    // only calls a model could make that leave no way back.
    const noWayBack = CATALOG.filter((e) => e.effect !== 'read' && !e.undoable)
    expect(noWayBack.map((e) => e.name).sort()).toEqual(['memory.clear', 'memory.reset'])
    for (const e of noWayBack) expect(describeEntry(e)).toContain('NOT undoable')
  })

  it('warns a model in prose as well as in a flag it never sees', () => {
    const del = CATALOG.find((e) => e.name === 'vault.file.delete')
    expect(describeEntry(del!)).toContain('Confirm with the user')
  })

  it('never calls a read destructive', () => {
    expect(CATALOG.filter((e) => e.effect === 'read').every((e) => !e.destructive)).toBe(true)
  })
})

describe('the two envelopes', () => {
  it('describes the same operation under the same name in both', () => {
    // Two names for one operation is how a trace stops matching a manifest.
    const fns = new Map(functionSpecs().map((f) => [f.function.name, f]))
    for (const mcp of mcpSpecs()) {
      const fn = fns.get(mcp.name)
      expect(fn).toBeDefined()
      expect(mcp.inputSchema).toEqual(fn?.function.parameters)
      expect(mcp.description).toBe(fn?.function.description)
    }
  })

  it('fills MCP hints from the same facts rather than guessing per tool', () => {
    const byName = new Map(mcpSpecs().map((m) => [m.name, m]))
    expect(byName.get('memory_list')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    })
    expect(byName.get('application_delete')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    })
    // Claiming idempotence for a create would be a lie a client may act on.
    expect(byName.get('application_create')?.annotations.idempotentHint).toBe(false)
  })

  it('gives every tool a non-empty schema and description', () => {
    for (const spec of functionSpecs()) {
      expect(spec.function.description.length).toBeGreaterThan(10)
      expect(spec.function.parameters.type).toBe('object')
    }
  })
})
