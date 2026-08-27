/**
 * The trust boundary. Everything read off disk passes through here once.
 *
 * The assertions that matter most are the negative ones: a rejection has to
 * come back as a counted diagnostic naming the record, never as a throw and
 * never as a silent skip. Local-first means a dropped node is lost work with no
 * server backup and no undo.
 */

import { describe, expect, it } from 'vitest'
import type { NodePropsByType, NodeType, StoredEdge, StoredNode } from './model'
import { NODE_TYPES } from './model'
import { edgeId, newNodeId } from './ref'
import {
  NODE_PROP_SCHEMAS,
  checkInvariants,
  validateEdge,
  validateNode,
  validateRows,
} from './validate'

const AT = Date.UTC(2026, 9, 12)
const NOW = '2026-10-12T09:14:22.311Z'

function node<T extends NodeType>(type: T, props: NodePropsByType[T]): StoredNode<T> {
  return { id: newNodeId(type, AT), type, props, createdAt: NOW, updatedAt: NOW } as StoredNode<T>
}

const application = (slug: string) =>
  node('application', {
    slug,
    role: 'Statistics',
    note: '',
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: NOW,
  })

const organisation = (slug: string) => node('organisation', { slug, name: slug })

const keyword = (slug: string) => node('keyword', { slug, name: slug, tone: 'teal' })

const edge = (from: StoredNode, rel: StoredEdge['rel'], to: StoredNode): StoredEdge => ({
  id: edgeId(from.id, rel, to.id),
  rel,
  from: from.id,
  to: to.id,
  props: {},
  createdAt: NOW,
})

describe('NODE_PROP_SCHEMAS', () => {
  // A type with no schema is a type whose records cannot be read back, which is
  // discovered on the second launch rather than in review.
  it('covers every node type', () => {
    for (const type of NODE_TYPES) expect(NODE_PROP_SCHEMAS[type].meta.kind).toBe('object')
  })

  /**
   * D25, enforced rather than remembered.
   *
   * `daysAgo` was stored and zeroed on every edit, and has only ever been right
   * because a reload wiped it — on disk it starts lying on the second launch.
   * `linked` needed four write sites to stay honest. Both are one careless
   * `s.boolean()` away from coming back, and neither would fail a single other
   * test: they would simply be wrong, quietly, from the second launch onward.
   */
  it('has no derived value anywhere in props', () => {
    const derived = ['daysAgo', 'allDay', 'linked', 'degree', 'displayName', 'applicationId']
    for (const type of NODE_TYPES) {
      const fields = Object.keys(NODE_PROP_SCHEMAS[type].meta.fields ?? {})
      expect({ type, derived: fields.filter((f) => derived.includes(f)) }).toEqual({
        type,
        derived: [],
      })
    }
  })

  it('requires a non-blank slug everywhere it appears', () => {
    for (const type of NODE_TYPES) {
      if (type === 'profile') continue
      expect(NODE_PROP_SCHEMAS[type].meta.fields?.['slug']).toEqual({
        kind: 'string',
        label: 'Slug',
        min: 1,
      })
    }
  })
})

describe('validateNode', () => {
  it('accepts a well-formed record unchanged', () => {
    const value = application('rice')
    expect(validateNode(value)).toEqual({ ok: true, value })
  })

  it('reports rather than throws on every malformed shape', () => {
    for (const row of [null, 42, 'rice', [], {}]) {
      const parsed = validateNode(row)
      expect(parsed.ok).toBe(false)
    }
  })

  it('names the record it skipped whenever it can', () => {
    const broken = { ...application('rice'), props: { slug: '' } }
    const parsed = validateNode(broken)
    expect(parsed.ok === false && parsed.diagnostics[0]?.id).toBe(broken.id)
    expect(parsed.ok === false && parsed.diagnostics[0]?.store).toBe('nodes')
  })

  /**
   * The id and the `type` field are two spellings of one fact — 'app:0192…'
   * already says application. A row where they disagree was written by a bug,
   * and catching it here is cheaper than catching it three layers up where the
   * projection hands an application's props to a keyword's renderer.
   */
  it('rejects a record whose id and type disagree', () => {
    const value = { ...application('rice'), type: 'keyword' }
    const parsed = validateNode(value)
    expect(parsed.ok === false && parsed.diagnostics[0]?.message).toContain('its id says')
  })

  it('rejects a bare id, which is never a valid key', () => {
    const value = { ...application('rice'), id: 'rice' }
    expect(validateNode(value).ok).toBe(false)
  })

  /**
   * The envelope's timestamps used to get a non-empty-string check while
   * `lastActionAt` one field away went through `s.instant`, so a hand-edited or
   * truncated backup carrying `updatedAt: 'undefined'` crossed the trust
   * boundary untouched and rendered as the literal 'undefined NaN' in the
   * thread list — a corrupt record found by screenshot rather than by a counted
   * diagnostic.
   */
  it('rejects a timestamp that is a string but not a time', () => {
    for (const at of ['undefined', '5', 'Mar 5 2026', '2026-02-31T00:00:00.000Z']) {
      const parsed = validateNode({ ...application('rice'), updatedAt: at })
      expect(parsed.ok === false && parsed.diagnostics[0]?.message).toBe(
        'Its timestamps are not times.',
      )
    }
    expect(validateNode({ ...application('rice'), createdAt: 'x' }).ok).toBe(false)
  })
})

describe('validateEdge', () => {
  it('accepts a well-typed edge and defaults absent props to {}', () => {
    const app = application('rice')
    const org = organisation('rice')
    const value = edge(app, 'AT', org)
    expect(validateEdge(value)).toEqual({ ok: true, value })

    const noProps: Record<string, unknown> = { ...value }
    delete noProps['props']
    const parsed = validateEdge(noProps)
    expect(parsed.ok && parsed.value.props).toEqual({})
  })

  it('rejects an id that disagrees with its own ends', () => {
    const value = { ...edge(application('rice'), 'AT', organisation('rice')), id: 'a|AT|b' }
    expect(validateEdge(value).ok).toBe(false)
  })

  /**
   * EDGE_SCHEMA is checked here rather than in a later pass because
   * type-prefixed ids make it a pure question: the key carries both endpoint
   * types. An edge the schema forbids has no projection that will ever read it,
   * so keeping it would mean a row that exists, exports, and renders nowhere.
   */
  it('rejects an edge the schema forbids', () => {
    const parsed = validateEdge(edge(keyword('read'), 'AT', organisation('rice')))
    expect(parsed.ok === false && parsed.diagnostics[0]?.message).toBe(
      'A keyword cannot is at a organisation.',
    )
  })

  // Same envelope, same hole: an edge's one timestamp was a non-empty-string
  // check too, and it is the field the journal dates every change by.
  it('rejects a timestamp that is a string but not a time', () => {
    const value = { ...edge(application('rice'), 'AT', organisation('rice')), createdAt: '5' }
    const parsed = validateEdge(value)
    expect(parsed.ok === false && parsed.diagnostics[0]?.message).toBe(
      'Its timestamp is not a time.',
    )
  })
})

describe('validateRows', () => {
  it('keeps what it can and reports every record it could not', () => {
    const app = application('rice')
    const org = organisation('rice')
    const rows = validateRows([app, org, { id: 'nonsense' }], [edge(app, 'AT', org)])

    expect(rows.nodes).toHaveLength(2)
    expect(rows.edges).toHaveLength(1)
    expect(rows.skipped).toHaveLength(1)
  })

  // The graph spelling of `addEdge`'s both-ends guard in `lib/graph/build.ts`:
  // an edge with a missing end would
  // render as a line running off into empty space, which reads as the layout
  // having broken rather than as a record having gone.
  it('drops an edge whose end did not survive, and says so', () => {
    const app = application('rice')
    const org = organisation('rice')
    const rows = validateRows([app], [edge(app, 'AT', org)])

    expect(rows.edges).toHaveLength(0)
    expect(rows.skipped[0]?.message).toBe('Joins a record that is not there.')
  })

  it('reports a duplicate id instead of quietly keeping one', () => {
    const app = application('rice')
    const rows = validateRows([app, { ...app, props: { ...app.props, slug: 'rice-2' } }], [])
    expect(rows.nodes).toHaveLength(1)
    expect(rows.skipped[0]?.message).toContain('Appeared twice')
  })

  /**
   * WHICH of the two it keeps, which the count above cannot see.
   *
   * A duplicate primary key cannot come out of IndexedDB, so this only fires on
   * an import or a merge — and there the two rows are the same record at two
   * moments, so "last one wins" is "the newer file wins", which is what a
   * restore means. First-one-wins is the same diagnostic over the wrong record:
   * the count is right, the content is silently a month old, and nothing on
   * screen says so. Asserting the count alone left that free to flip.
   */
  it('keeps the LATER of two rows sharing an id, not the first', () => {
    const app = application('rice')
    const rows = validateRows(
      [
        { ...app, props: { ...app.props, note: 'the copy on disk' } },
        { ...app, props: { ...app.props, note: 'the one being imported' } },
      ],
      [],
    )

    expect(rows.nodes).toHaveLength(1)
    expect(rows.nodes[0]?.props).toMatchObject({ note: 'the one being imported' })
  })

  /**
   * R-1(d) on the EDGE side, which the node side's coverage does not reach.
   *
   * The two loops report independently, and an edge is a record too: a `TAGS`
   * row is the only thing that says a keyword is on an application, so a
   * malformed one dropped without a diagnostic is a tag that vanishes with
   * nothing in Diagnostics, nothing counted, and nothing offered to export. The
   * rejection is the loud half of "never drop silently"; without it the boot
   * reads clean while the graph is missing a relationship.
   */
  it('counts a malformed edge row, rather than dropping it quietly', () => {
    const app = application('rice')
    const org = organisation('rice')
    const good = edge(app, 'AT', org)
    const rows = validateRows([app, org], [good, { ...good, id: 'not-an-edge-id' }])

    expect(rows.edges).toHaveLength(1)
    expect(rows.skipped).toEqual([
      { store: 'edges', id: 'not-an-edge-id', message: 'Its id disagrees with its ends.' },
    ])
  })
})

describe('checkInvariants', () => {
  it('is silent on a consistent store', () => {
    const app = application('rice')
    const org = organisation('rice')
    expect(checkInvariants([app, org], [edge(app, 'AT', org)])).toEqual([])
  })

  it('catches two records of one type sharing a slug', () => {
    const problems = checkInvariants([application('rice'), application('rice')], [])
    expect(problems[0]?.message).toContain("share 'rice'")
  })

  // The same slug under two types is fine and has to stay fine: six seeded
  // records answer to 'stripe', which is the whole reason ids carry their type.
  it('allows one slug across two types', () => {
    expect(checkInvariants([application('stripe'), organisation('stripe')], [])).toEqual([])
  })

  /**
   * `fromCardinality: 'one'` is what preserves the old `applicationId?: string`
   * semantics. The invariant used to live nowhere at all — it was implied by the
   * field being a scalar — so nothing stopped a second write leaving a record
   * pointing at two things at once.
   */
  it('catches a second outgoing edge on a one-target relation', () => {
    const app = application('rice')
    const first = organisation('rice')
    const second = organisation('baylor')
    const problems = checkInvariants(
      [app, first, second],
      [edge(app, 'AT', first), edge(app, 'AT', second)],
    )
    expect(problems[0]?.message).toContain('allows one target')
  })

  it('leaves a many relation alone', () => {
    const app = application('rice')
    const read = keyword('read')
    const research = keyword('research')
    const problems = checkInvariants(
      [app, read, research],
      [edge(read, 'TAGS', app), edge(research, 'TAGS', app)],
    )
    expect(problems).toEqual([])
  })
})
