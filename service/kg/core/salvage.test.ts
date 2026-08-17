/**
 * Field-level salvage on the restore path, and the schema for the five location
 * props it salvages.
 *
 * Both halves exist because of one arithmetic fact about `validateRows`: a node
 * fails as a WHOLE. Declaring `bytes` buys a real trust boundary — without it
 * `bytes: "banana"` reaches `sizeLabel` — and costs the record, its name, its
 * note and every incident edge when a value is wrong. On the hydrate path that
 * is correct: a value that wrong means the database is corrupt, and this app
 * refuses to paper over that. On the restore path it is not, because the source
 * is a JSON file on a user's disk that they may have synced, copied, restored
 * from a different moment, or opened in an editor.
 */

import { describe, expect, it } from 'vitest'
import { validateRows } from './validate'

const fileRow = (props: Record<string, unknown>) => ({
  id: 'file:0199aaaa-0000-7000-8000-000000000001',
  type: 'file',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  props: {
    slug: 'cv-rice',
    name: 'CV Rice.pdf',
    kind: 'pdf',
    bucket: 'Applications',
    size: '184 KB',
    savedOn: '2026-01-01',
    ...props,
  },
})

describe('the five location props', () => {
  it('are accepted when well formed', () => {
    const out = validateRows(
      [
        fileRow({
          path: 'Documents/CV Rice.pdf',
          bytes: 188_416,
          mtime: 1_700_000,
          hash: 'sha256:ab',
        }),
      ],
      [],
    )
    expect(out.skipped).toEqual([])
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]?.props).toMatchObject({ path: 'Documents/CV Rice.pdf', bytes: 188_416 })
  })

  /** Their absence is a complete, valid record — every file that predates the folder. */
  it('are all optional', () => {
    const out = validateRows([fileRow({})], [])
    expect(out.skipped).toEqual([])
    expect(out.nodes[0]?.props).not.toHaveProperty('path')
  })

  // The reason to declare them at all: without the schema this reaches
  // `sizeLabel` and renders as `NaN KB` on the row.
  it('reject a wrong type at the trust boundary', () => {
    const out = validateRows([fileRow({ bytes: 'banana' })], [])
    expect(out.nodes).toEqual([])
    expect(out.skipped).toHaveLength(1)
  })

  it('reject a negative byte count', () => {
    expect(validateRows([fileRow({ bytes: -1 })], []).nodes).toEqual([])
  })

  /*
   * `uri` is the fifth, and until the mobile fork was deleted it was the only
   * one of the five that either app actually wrote — declared on the phone's
   * copy of `model.ts`, accepted by its `vault.file.add`, and checked by
   * nothing. `s.object` passes unknown keys through by design, so the value
   * below round-tripped intact all the way to `openDocument(file.uri)` in
   * `screens/vault/FileViewer.tsx`. The next two cases are the falsification of
   * that: without the declaration in `validate.ts` the first one keeps the row.
   */
  it('accept a well-formed uri', () => {
    const out = validateRows([fileRow({ uri: 'file:///data/user/0/dev.jojo/files/CV.pdf' })], [])
    expect(out.skipped).toEqual([])
    expect(out.nodes[0]?.props).toMatchObject({
      uri: 'file:///data/user/0/dev.jojo/files/CV.pdf',
    })
  })

  it('reject a uri that is not a string', () => {
    const out = validateRows([fileRow({ uri: 99 })], [])
    expect(out.nodes).toEqual([])
    expect(out.skipped).toHaveLength(1)
  })
})

describe('salvage', () => {
  /**
   * The whole point. One bad digit in a field describing a document sitting in
   * the same folder must not cost the application record it belongs to.
   */
  it('keeps the record and drops only the link', () => {
    const out = validateRows([fileRow({ path: 'Documents/CV.pdf', bytes: 'banana' })], [], {
      salvage: true,
    })
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]?.props).toMatchObject({ name: 'CV Rice.pdf', size: '184 KB' })
    expect(out.nodes[0]?.props).not.toHaveProperty('bytes')
    expect(out.nodes[0]?.props).not.toHaveProperty('path')
  })

  /** A loss, reported in its own words rather than folded in with dropped records. */
  it('reports the salvage rather than doing it silently', () => {
    const out = validateRows([fileRow({ bytes: 'banana' })], [], { salvage: true })
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0]?.message).toBe('Came back without its document link.')
    expect(out.skipped[0]?.id).toBe('file:0199aaaa-0000-7000-8000-000000000001')
  })

  /**
   * Off by default, and the default is what the hydrate path uses. A value this
   * wrong coming out of IndexedDB means the database is corrupt, and the corrupt
   * arm exists to say so — quietly repairing it there would hide the one signal
   * that tells a user to export what can still be read.
   */
  it('does nothing unless asked', () => {
    expect(validateRows([fileRow({ bytes: 'banana' })], []).nodes).toEqual([])
  })

  /** A stale `uri` in a restored backup costs an Open button, never the record. */
  it('drops a bad uri and keeps the file', () => {
    const out = validateRows([fileRow({ uri: 99 })], [], { salvage: true })
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]?.props).toMatchObject({ name: 'CV Rice.pdf' })
    expect(out.nodes[0]?.props).not.toHaveProperty('uri')
  })

  /** Salvage is scoped to the five location props, not "retry without whatever failed". */
  it('will not rescue a record broken anywhere else', () => {
    const broken = fileRow({ path: 'Documents/CV.pdf' })
    broken.props.kind = 'not-a-kind'
    const out = validateRows([broken], [], { salvage: true })
    expect(out.nodes).toEqual([])
    expect(out.skipped[0]?.message).not.toBe('Came back without its document link.')
  })

  /**
   * The consequence that makes salvage worth its complexity: `validateRows`
   * filters edges against surviving nodes, so losing this file would silently
   * take its keyword links with it.
   */
  it('keeps the edges that would have gone with the record', () => {
    const kw = {
      id: 'kw:0199bbbb-0000-7000-8000-000000000002',
      type: 'keyword',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      props: { slug: 'referral', name: 'Referral', tone: 'teal' },
    }
    const edge = {
      id: `${kw.id}|TAGS|file:0199aaaa-0000-7000-8000-000000000001`,
      rel: 'TAGS',
      from: kw.id,
      to: 'file:0199aaaa-0000-7000-8000-000000000001',
      createdAt: '2026-01-01T00:00:00.000Z',
      props: {},
    }
    const rows = [fileRow({ bytes: 'banana' }), kw]

    expect(validateRows(rows, [edge]).edges).toEqual([])
    expect(validateRows(rows, [edge], { salvage: true }).edges).toHaveLength(1)
  })
})
