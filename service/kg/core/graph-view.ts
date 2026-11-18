/**
 * L1 — how a large graph is drawn calmly: fold the leaves, group what is left,
 * and lay one record out with its neighbours in rings.
 *
 * WHY THIS EXISTS. A store of 2,700 records is mostly small bundles — an
 * application, its employer, two dates and a file — and 74% of its records have
 * exactly one link. Drawn as a force layout, the only thing joining those bundles
 * is a handful of shared nodes (the five role tags), so the physics knots
 * everything round them under a permanent mesh of ~2,500 lines. That picture is
 * noise. This module draws the same records three ways instead:
 *
 *   - `foldLeaves` counts every record whose only link is to one other record ON
 *     that record, instead of drawing it as a dot ("2 dates · 1 file").
 *   - `clusterLayout` puts what is left into labelled circles by a dimension the
 *     person picks (role, stage, organisation, keyword), deterministically — no
 *     simulation, O(n log n), the same picture every time the page opens.
 *   - `focusLayout` puts one record at the centre with its neighbours in rings.
 *
 * Pure and platform-free on purpose: no React, no DOM, no i18next. It works on
 * the smallest shape both apps can hand it — `ViewGraph` below — so the phone
 * draws the same overview from the same rules. Words (group names, "Shared",
 * the folded-count phrases) are the caller's: this module returns keys and
 * counts, and the app turns them into language.
 *
 * Every function here is deterministic: the same graph in the same order gives
 * the same output, byte for byte. Ties are broken on input order or on plain
 * string comparison, never on `localeCompare` (which depends on the runtime's
 * locale) and never on Map iteration order of something built from a Set the
 * caller did not order.
 */

/* --------------------------------- shapes --------------------------------- */

/** The least a node needs to be folded, grouped and placed. */
export type ViewNode = {
  readonly id: string
  /** Free-form kind ('application', 'file', …). Used for counts and ordering only. */
  readonly type: string
  readonly label: string
  /**
   * Dimension name → this record's values on it, e.g. `{ role: ['Professor'],
   * keyword: ['ml', 'nlp'] }`. A node that has a value list for the chosen
   * dimension is an ANCHOR: it is placed by its own value. One that has none is
   * placed by its neighbours (see `groupOf`). An empty list means "an anchor
   * with no value" and lands in `GROUP_NONE`.
   */
  readonly groupKeys?: Readonly<Record<string, readonly string[]>>
}

/** An undirected link. `rel` is carried through for the caller; nothing here reads it. */
export type ViewEdge = { readonly from: string; readonly to: string; readonly rel: string }

export type ViewGraph = { readonly nodes: readonly ViewNode[]; readonly edges: readonly ViewEdge[] }

export type Point = { readonly x: number; readonly y: number }

/* ------------------------------- constants -------------------------------- */

/**
 * Above this many drawn nodes (after folding) the overview replaces the free
 * force layout. One named number so both apps switch at the same size.
 *
 * 150 because that is roughly where a force layout in a ~960×620 box stops
 * reading as a picture: below it the demo store and any personal store of a few
 * dozen applications keep today's free layout, unchanged.
 */
export const OVERVIEW_THRESHOLD = 150

/**
 * Group keys this module mints, all starting with '@'. A caller may mint its
 * own '@' key for records that are always a group of their own however few —
 * the apps' '@you' for the person's own records — by naming it in
 * `GroupOptions.specialKeys`.
 *
 * Real dimension values come off records (a keyword '@remote', an employer
 * '@Road') and may start with '@' too. `groupOf` escapes those with
 * `GROUP_ESCAPE`, so a keyword '@shared' can never merge into the Shared group
 * and a run of '@' employers is pooled like any other value. The escape is an
 * invisible WORD JOINER, so a group key printed as it is still reads as the
 * value; `groupValue` strips it.
 */
export const GROUP_ESCAPE = '\u2060'
/** The record value a group key stands for: the key, unescaped. */
export const groupValue = (key: string) => (key.startsWith(GROUP_ESCAPE) ? key.slice(GROUP_ESCAPE.length) : key)
/** What `GroupOptions.specialKeys` is when not given: the apps' own key for the person's records. */
export const CALLER_SPECIAL_KEYS: readonly string[] = ['@you']

export const GROUP_SHARED = '@shared'
/** Anchors whose value list for the dimension is empty — "no keyword". */
export const GROUP_NONE = '@none'
/** Values beyond `maxGroups` — big enough to group, too many to draw — pooled. */
export const GROUP_REST = '@rest'
/**
 * Values held by fewer than `minGroupSize` records, pooled: with the default of
 * two, the employers with one application each ("One application each · 480"),
 * which on most stores is most of them.
 */
export const GROUP_SINGLES = '@singles'
/** Records with no links at all, drawn as one counted node. */
export const GROUP_LOOSE = '@loose'
/** Prefix for records that reach no anchor; the rest of the key is their type. */
export const GROUP_TYPE_PREFIX = '@type:'

/** True for every key this module mints rather than reads off a record. */
export const isSpecialGroup = (key: string) => key.startsWith('@')

/* ------------------------------- adjacency -------------------------------- */

/**
 * Distinct neighbours per node, in edge order, without self loops or edges to
 * ids the graph does not hold. Cached per graph object, so the overview and the
 * focus view of one graph share one index.
 */
const ADJACENCY = new WeakMap<ViewGraph, Map<string, string[]>>()

export function adjacency(graph: ViewGraph): ReadonlyMap<string, readonly string[]> {
  const cached = ADJACENCY.get(graph)
  if (cached) return cached
  const adj = new Map<string, string[]>()
  for (const node of graph.nodes) adj.set(node.id, [])
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue
    const a = adj.get(edge.from)
    const b = adj.get(edge.to)
    if (!a || !b) continue
    const key = edge.from < edge.to ? `${edge.from}\u0000${edge.to}` : `${edge.to}\u0000${edge.from}`
    if (seen.has(key)) continue
    seen.add(key)
    a.push(edge.to)
    b.push(edge.from)
  }
  ADJACENCY.set(graph, adj)
  return adj
}

/* -------------------------------- folding --------------------------------- */

export type Folding = {
  /** Ids still drawn as nodes, in input order. Excludes folded and loose records. */
  readonly visible: readonly string[]
  /** Records with no links at all that may fold — drawn as one `GROUP_LOOSE` node. */
  readonly loose: readonly string[]
  /** Folded id → the record it folded into (one step; may itself be folded). */
  readonly parent: ReadonlyMap<string, string>
  /** Folded id → the visible record its count is shown on. */
  readonly host: ReadonlyMap<string, string>
  /** Visible id → every record folded into it (directly or through a chain), in input order. */
  readonly folded: ReadonlyMap<string, readonly string[]>
  /** The input edges whose two ends are both visible. */
  readonly edges: readonly ViewEdge[]
}

export type FoldOptions = {
  /**
   * May this record be folded or pooled as loose? Default: yes. Return false for
   * records the picture is ABOUT (applications) and the person's own records,
   * which must never vanish into a count.
   */
  readonly canFold?: (node: ViewNode) => boolean
}

/**
 * Folds every record whose only link is to one other record into that record.
 *
 * Peels repeatedly, so a file filed under a date that is about an application
 * ends up counted on the application ("1 date · 1 file") rather than leaving the
 * date drawn as a dot with a count of its own. A record with two or more
 * distinct neighbours is never folded — unless leaves folding INTO it bring it
 * down to one, which is the same rule applied again.
 *
 * Two foldable records linked only to each other: the one earlier in input
 * order stays and the other is counted on it. A chain of foldable records
 * therefore peels from both ends to one survivor, which carries the rest.
 *
 * Records with no links at all are `loose` (one counted node), never dots —
 * unless `canFold` refuses them, in which case they stay visible.
 */
export function foldLeaves(graph: ViewGraph, options: FoldOptions = {}): Folding {
  const canFold = options.canFold ?? (() => true)
  const adj = adjacency(graph)
  const order = new Map<string, number>()
  const byId = new Map<string, ViewNode>()
  graph.nodes.forEach((node, at) => {
    order.set(node.id, at)
    byId.set(node.id, node)
  })

  const foldable = new Set<string>()
  for (const node of graph.nodes) if (canFold(node)) foldable.add(node.id)

  const degree = new Map<string, number>()
  const alive = new Set<string>()
  const loose: string[] = []
  for (const node of graph.nodes) {
    const d = adj.get(node.id)?.length ?? 0
    if (d === 0 && foldable.has(node.id)) {
      loose.push(node.id)
      continue
    }
    degree.set(node.id, d)
    alive.add(node.id)
  }

  const parent = new Map<string, string>()
  // FIFO over input order, then whatever a fold exposes — so the peel order,
  // and therefore every tie, is a function of the input order alone.
  const queue: string[] = []
  for (const node of graph.nodes) {
    if (alive.has(node.id) && degree.get(node.id) === 1 && foldable.has(node.id)) {
      queue.push(node.id)
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]
    if (id === undefined || !alive.has(id) || degree.get(id) !== 1) continue
    const into = (adj.get(id) ?? []).find((other) => alive.has(other))
    if (into === undefined) continue
    // A pair of leaves linked only to each other: the earlier one stays.
    if (
      degree.get(into) === 1 &&
      foldable.has(into) &&
      (order.get(into) ?? 0) > (order.get(id) ?? 0)
    ) {
      continue
    }
    alive.delete(id)
    parent.set(id, into)
    const left = (degree.get(into) ?? 0) - 1
    degree.set(into, left)
    if (left === 1 && foldable.has(into)) queue.push(into)
  }

  const host = new Map<string, string>()
  const resolve = (id: string): string => {
    const known = host.get(id)
    if (known !== undefined) return known
    let at = id
    const path: string[] = []
    while (!alive.has(at)) {
      path.push(at)
      const up = parent.get(at)
      if (up === undefined) break
      at = up
    }
    for (const step of path) host.set(step, at)
    return at
  }

  const folded = new Map<string, string[]>()
  for (const node of graph.nodes) {
    if (!parent.has(node.id)) continue
    const top = resolve(node.id)
    const list = folded.get(top)
    if (list) list.push(node.id)
    else folded.set(top, [node.id])
  }

  const visible = graph.nodes.filter((n) => alive.has(n.id)).map((n) => n.id)
  const edges = graph.edges.filter(
    (e) => e.from !== e.to && alive.has(e.from) && alive.has(e.to),
  )
  return { visible, loose, parent, host, folded, edges }
}

const MEMBERSHIP = new WeakMap<Folding, { visible: Set<string>; loose: Set<string> }>()

/**
 * Where a record is drawn: itself when visible, its host when folded,
 * `GROUP_LOOSE` when it has no links, undefined when the graph does not hold it.
 */
export function hostOf(folding: Folding, id: string): string | undefined {
  const host = folding.host.get(id)
  if (host !== undefined) return host
  let sets = MEMBERSHIP.get(folding)
  if (!sets) {
    sets = { visible: new Set(folding.visible), loose: new Set(folding.loose) }
    MEMBERSHIP.set(folding, sets)
  }
  if (sets.loose.has(id)) return GROUP_LOOSE
  return sets.visible.has(id) ? id : undefined
}

/**
 * What is folded into a record, counted by type: `[{ type: 'item', count: 2 },
 * { type: 'file', count: 1 }]`. Largest count first, ties in `typeOrder` (then
 * by type name). The app turns each pair into a counted phrase and joins them.
 */
export function foldedSummary(
  folding: Folding,
  typeOf: (id: string) => string | undefined,
  id: string,
  typeOrder: readonly string[] = [],
): { type: string; count: number }[] {
  return countTypes(folding.folded.get(id) ?? [], typeOf, typeOrder)
}

/** The same count over any list of ids — the loose group, a ring's overflow. */
export function countTypes(
  ids: readonly string[],
  typeOf: (id: string) => string | undefined,
  typeOrder: readonly string[] = [],
): { type: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const child of ids) {
    const type = typeOf(child)
    if (type !== undefined) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const rank = (type: string) => {
    const at = typeOrder.indexOf(type)
    return at === -1 ? typeOrder.length : at
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        rank(a.type) - rank(b.type) ||
        (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
    )
}

/**
 * Should this graph open on the overview rather than the free layout?
 * Counts what would actually be drawn: visible records plus the one loose node.
 */
export function wantsOverview(folding: Folding, threshold = OVERVIEW_THRESHOLD): boolean {
  return folding.visible.length + (folding.loose.length > 0 ? 1 : 0) > threshold
}

/* -------------------------------- grouping -------------------------------- */

export type GroupOptions = {
  /** The dimension: a key of `ViewNode.groupKeys` ('role', 'stage', …). */
  readonly by: string
  /** Only `folding.visible` is grouped. Omitted, every node is. */
  readonly folding?: Folding
  /** A value with fewer anchors than this is pooled into `GROUP_SINGLES`. Default 2. */
  readonly minGroupSize?: number
  /** At most this many named groups; the smallest beyond it are pooled. Default 20. */
  readonly maxGroups?: number
  /**
   * The '@' values the caller minted itself, each always a group of its own.
   * Every other value starting with '@' is a real value and is escaped (see
   * `GROUP_ESCAPE`). Default `CALLER_SPECIAL_KEYS`.
   */
  readonly specialKeys?: Iterable<string>
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Which group each drawn record belongs to, by one dimension.
 *
 * Anchors (records carrying the dimension) go by their own value. A record with
 * SEVERAL values — keywords — goes to whichever of them is most common across
 * the graph (ties: the alphabetically first), so the circles are the big shared
 * themes rather than one circle per combination; an application tagged
 * `ml` and `rust` sits with the other `ml` work when `ml` is the bigger theme.
 * Values held by fewer than `minGroupSize` anchors are pooled into
 * `GROUP_SINGLES` — a circle per organisation with one application each is 500
 * circles of one, which is not grouping — and values big enough to group but
 * beyond the `maxGroups` largest into `GROUP_REST`.
 *
 * Everything else (people, keywords, postings, claims, the role diamonds) joins
 * its neighbours: the group that holds MORE THAN HALF of its already-grouped
 * neighbours, else `GROUP_SHARED`. Decided in rings outward from the anchors, so
 * a record two steps from any application is placed by the records one step
 * away. A record that reaches no anchor at all is grouped by its own type
 * (`GROUP_TYPE_PREFIX + type`).
 */
export function groupOf(graph: ViewGraph, options: GroupOptions): Map<string, string> {
  const { by, folding } = options
  const minGroupSize = options.minGroupSize ?? 2
  const maxGroups = options.maxGroups ?? 20
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const ids = folding ? folding.visible : graph.nodes.map((n) => n.id)
  const drawn = new Set(ids)
  const adj = adjacency(graph)
  const callerKeys = new Set(options.specialKeys ?? CALLER_SPECIAL_KEYS)
  const keyOf = (value: string) =>
    isSpecialGroup(value) && !callerKeys.has(value) ? GROUP_ESCAPE + value : value

  // 1. How many anchors carry each value.
  const frequency = new Map<string, number>()
  const anchors: { id: string; values: readonly string[] }[] = []
  for (const id of ids) {
    const values = byId.get(id)?.groupKeys?.[by]
    if (values === undefined) continue
    const distinct = [...new Set(values.map(keyOf))]
    anchors.push({ id, values: distinct })
    for (const value of distinct) frequency.set(value, (frequency.get(value) ?? 0) + 1)
  }

  // A caller's own special key ('@you') is always its own group, and is not
  // counted against `maxGroups`: it is a kind of record, not a value that
  // happened to be rare.
  const ranked = [...frequency]
    .filter(([value, n]) => n >= minGroupSize && !isSpecialGroup(value))
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
  const kept = new Set(ranked.slice(0, maxGroups).map(([value]) => value))
  for (const value of frequency.keys()) if (isSpecialGroup(value)) kept.add(value)

  // 2. Each anchor to its most common surviving value.
  const group = new Map<string, string>()
  for (const { id, values } of anchors) {
    if (values.length === 0) {
      group.set(id, GROUP_NONE)
      continue
    }
    let best: string | undefined
    for (const value of values) {
      if (!kept.has(value)) continue
      if (
        best === undefined ||
        (frequency.get(value) ?? 0) > (frequency.get(best) ?? 0) ||
        ((frequency.get(value) ?? 0) === (frequency.get(best) ?? 0) && value < best)
      ) {
        best = value
      }
    }
    // Nothing kept: "too many groups" if any of its values was big enough to
    // be one, otherwise "one each".
    const big = values.some((value) => (frequency.get(value) ?? 0) >= minGroupSize)
    group.set(id, best ?? (big ? GROUP_REST : GROUP_SINGLES))
  }

  // A value kept for its frequency can still end with too few actual members,
  // when most of its holders went to a commoner value. Pool those too.
  const members = new Map<string, number>()
  for (const key of group.values()) members.set(key, (members.get(key) ?? 0) + 1)
  for (const [id, key] of group) {
    if (!isSpecialGroup(key) && (members.get(key) ?? 0) < minGroupSize) group.set(id, GROUP_SINGLES)
  }

  // 3. Everyone else, in rings outward from the anchors.
  let frontier = ids.filter((id) => !group.has(id))
  while (frontier.length > 0) {
    const decided: [string, string][] = []
    const rest: string[] = []
    for (const id of frontier) {
      const tally = new Map<string, number>()
      let total = 0
      for (const other of adj.get(id) ?? []) {
        if (!drawn.has(other)) continue
        const key = group.get(other)
        if (key === undefined) continue
        tally.set(key, (tally.get(key) ?? 0) + 1)
        total += 1
      }
      if (total === 0) {
        rest.push(id)
        continue
      }
      let winner = GROUP_SHARED
      for (const [key, n] of tally) if (n * 2 > total) winner = key
      decided.push([id, winner])
    }
    // Applied after the ring is read, so the order records are visited in
    // within one ring cannot change which group any of them joins.
    for (const [id, key] of decided) group.set(id, key)
    if (decided.length === 0) {
      for (const id of rest) group.set(id, GROUP_TYPE_PREFIX + (byId.get(id)?.type ?? ''))
      break
    }
    frontier = rest
  }

  return group
}

/* ------------------------------ cluster layout ----------------------------- */

/**
 * Sunflower spacing. Member 0 sits at the centre and member i ≥ 1 at radius
 * `SUNFLOWER · √(i + SUNFLOWER_OFFSET)`; measured over 2–3,000 members, this
 * pair keeps every two members at least one cell apart (worst case 1.05).
 */
const SUNFLOWER = 0.65
const SUNFLOWER_OFFSET = 1.6
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** A member's own radius, in cells, plus breathing room inside its circle. */
const MEMBER_PAD = 0.9

export type ClusterOptions = GroupOptions & {
  /** The box to fit, in the caller's own units (the SVG viewBox). */
  readonly width: number
  readonly height: number
  /** Member order inside a group — the centre first, spiralling out. Default: type, label, id. */
  readonly order?: (a: ViewNode, b: ViewNode) => number
  /** The largest a cell (member spacing) may grow to on a small graph. Default 26. */
  readonly maxCell?: number
  /** Margin kept clear inside the box. Default 16. */
  readonly margin?: number
  /** Height reserved above each circle for its label. Default 18. */
  readonly labelHeight?: number
  /** Width of a group's label in the caller's units, for spacing. Default: none reserved. */
  readonly labelWidth?: (key: string, count: number) => number
  /** Smallest gap between two groups' footprints (circle plus label). Default 10. */
  readonly gap?: number
  /**
   * Group keys in the order they MEAN something — stages in pipeline order.
   * Given, groups are laid out in that order in rows, reading order, rather
   * than packed largest-first; keys not listed follow, largest first.
   */
  readonly groupOrder?: readonly string[]
}

export type ClusterGroup = {
  readonly key: string
  /** Member ids in layout order (centre outward). Empty for `GROUP_LOOSE`. */
  readonly members: readonly string[]
  /**
   * Members carrying the dimension — the count a label should show. For
   * `GROUP_LOOSE`, the number of loose records its one node stands for.
   */
  readonly anchors: number
  readonly x: number
  readonly y: number
  readonly r: number
  /**
   * Where the label's baseline goes: centred just above the circle, or — for
   * `GROUP_LOOSE`, which sits in a strip along the bottom — starting just
   * after its node (`labelAnchor` says which). The strip is at the left; an
   * RTL caller mirrors the loose group's x.
   */
  readonly labelX: number
  readonly labelY: number
  readonly labelAnchor: 'middle' | 'start'
}

export type ClusterLayout = {
  /** Every member's centre, plus `GROUP_LOOSE` when there is a loose node. */
  readonly positions: ReadonlyMap<string, Point>
  /** In reading order: top to bottom, then left to right. */
  readonly groups: readonly ClusterGroup[]
  readonly groupOf: ReadonlyMap<string, string>
  /** Member spacing in output units; draw members at a radius well under half of it. */
  readonly cell: number
  readonly width: number
  readonly height: number
}

const defaultOrder = (a: ViewNode, b: ViewNode) =>
  compareText(a.type, b.type) || compareText(a.label, b.label) || compareText(a.id, b.id)

const byLabel = (a: ViewNode, b: ViewNode) => compareText(a.label, b.label) || compareText(a.id, b.id)

type Footprint = { x: number; y: number; R: number }

/**
 * Lays the drawn records out in labelled circles, one per group.
 *
 * Inside a group, members sit on a sunflower spiral in `order` — the first at
 * the centre — so a group of any size is a compact disc with even spacing, and
 * the same members always land in the same seats. Groups are circle-packed,
 * largest first, each at the free spot nearest the middle (weighted by the
 * box's aspect, so a wide box gets a wide arrangement). Each circle's
 * footprint includes room for its label above it, so labels never sit on a
 * neighbouring circle. Then the whole picture is scaled to the box.
 *
 * O(n log n) in the records (one sort per group) plus O(g³) in the groups,
 * which `maxGroups` keeps small. No simulation, nothing random.
 */
export function clusterLayout(graph: ViewGraph, options: ClusterOptions): ClusterLayout {
  const { width, height, folding } = options
  const margin = options.margin ?? 16
  const maxCell = options.maxCell ?? 26
  const labelHeight = options.labelHeight ?? 18
  const gapPx = options.gap ?? 10
  const order = options.order ?? defaultOrder
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const assigned = groupOf(graph, options)

  const lists = new Map<string, string[]>()
  for (const [id, key] of assigned) {
    const list = lists.get(key)
    if (list) list.push(id)
    else lists.set(key, [id])
  }
  const loose = folding !== undefined && folding.loose.length > 0

  type Draft = { key: string; members: string[]; anchors: number; r: number; count: number }
  const drafts: Draft[] = []
  for (const [key, ids] of lists) {
    // "One each" is a list more than a cluster: alphabetical, so the records
    // in it can be found by name — and Tab and the arrows walk it A to Z.
    // Anything that joined it without the dimension (a role diamond) sits at
    // the centre first, rather than filed among the names.
    const carries = (n: ViewNode) => (n.groupKeys?.[options.by] === undefined ? 0 : 1)
    const members = ids
      .map((id) => byId.get(id))
      .filter((n): n is ViewNode => n !== undefined)
      .sort(key === GROUP_SINGLES ? (a, b) => carries(a) - carries(b) || byLabel(a, b) : order)
      .map((n) => n.id)
    const anchors = members.filter((id) => byId.get(id)?.groupKeys?.[options.by] !== undefined)
    drafts.push({
      key,
      members,
      anchors: anchors.length,
      r: SUNFLOWER * Math.sqrt(Math.max(members.length - 1, 0) + SUNFLOWER_OFFSET) + MEMBER_PAD,
      count: members.length,
    })
  }
  // The loose node is not packed: its label is far wider than its one node,
  // and a circle round both cost the big store a fifth of its scale. It sits
  // in a strip along the bottom instead, like a footnote.
  const strip = loose ? labelHeight + 12 : 0
  const packHeight = height - strip
  // Largest first, then by key, so packing order is a function of the data —
  // or the caller's meaningful order, laid out in rows instead of packed.
  const meaning = options.groupOrder
  const rank = (key: string) => {
    const at = meaning?.indexOf(key) ?? -1
    return at === -1 ? Infinity : at
  }
  drafts.sort(
    (a, b) =>
      (meaning ? rank(a.key) - rank(b.key) || 0 : 0) ||
      b.count - a.count ||
      compareText(a.key, b.key),
  )
  const arrange = meaning ? flow : pack

  // Pack twice: the label's height in cells depends on the scale, and the scale
  // on the packing. The second pass uses the first pass's scale.
  const aspect = Math.max(0.3, Math.min(4, width / Math.max(1, height)))
  const totalArea = drafts.reduce((sum, d) => sum + Math.PI * (d.r + 1.5) ** 2, 0)
  let cell = Math.min(
    maxCell,
    Math.sqrt(((width - 2 * margin) * (packHeight - 2 * margin)) / (totalArea / 0.55)),
  )
  let packed: { centres: Point[]; bounds: Bounds } = arrange(drafts, cell)

  for (let pass = 0; pass < 2; pass++) {
    const fit = Math.min(
      (width - 2 * margin) / Math.max(1e-6, packed.bounds.right - packed.bounds.left),
      (packHeight - 2 * margin) / Math.max(1e-6, packed.bounds.bottom - packed.bounds.top),
      maxCell,
    )
    if (Math.abs(fit - cell) / cell < 0.02) {
      cell = fit
      break
    }
    cell = fit
    packed = arrange(drafts, cell)
  }
  cell = Math.min(
    (width - 2 * margin) / Math.max(1e-6, packed.bounds.right - packed.bounds.left),
    (packHeight - 2 * margin) / Math.max(1e-6, packed.bounds.bottom - packed.bounds.top),
    maxCell,
  )

  /** The smallest circle round a group's disc and its label box: `k` above the disc's centre, radius r + k. */
  function footprint(draft: Draft, scale: number) {
    const cap = labelHeight / scale
    const labelW = (options.labelWidth?.(draft.key, draft.anchors || draft.count) ?? 0) / scale
    const k = Math.max(0, (labelW * labelW) / 4 + cap * cap + 2 * draft.r * cap) / (4 * draft.r + 2 * cap)
    return { k, R: draft.r + k }
  }

  /**
   * Rows, in the given order: every row holds the same number of groups, and
   * that number is whichever makes the picture largest in the box.
   */
  function flow(list: readonly Draft[], scale: number) {
    const gap = gapPx / scale
    const feet = list.map((draft) => footprint(draft, scale))
    let best: { perRow: number; score: number } = { perRow: Math.max(1, list.length), score: Infinity }
    for (let perRow = 1; perRow <= list.length; perRow++) {
      let w = 0
      let h = 0
      for (let at = 0; at < list.length; at += perRow) {
        const row = feet.slice(at, at + perRow)
        w = Math.max(w, row.reduce((sum, f) => sum + 2 * f.R, 0) + gap * (row.length - 1))
        h += Math.max(...row.map((f) => 2 * f.R)) + (at > 0 ? gap : 0)
      }
      const score = Math.max(w / aspect, h)
      if (score < best.score - 1e-9) best = { perRow, score }
    }
    const centres: Point[] = []
    const bounds: Bounds = { left: 0, right: 0, top: 0, bottom: 0 }
    let top = 0
    for (let at = 0; at < list.length; at += best.perRow) {
      const row = feet.slice(at, at + best.perRow)
      const rowW = row.reduce((sum, f) => sum + 2 * f.R, 0) + gap * (row.length - 1)
      const rowH = Math.max(...row.map((f) => 2 * f.R))
      let x = -rowW / 2
      for (const f of row) {
        const cy = top + rowH / 2
        centres.push({ x: x + f.R, y: cy + f.k })
        bounds.left = Math.min(bounds.left, x)
        bounds.right = Math.max(bounds.right, x + 2 * f.R)
        x += 2 * f.R + gap
      }
      bounds.bottom = top + rowH
      top += rowH + gap
    }
    return { centres, bounds }
  }

  function pack(list: readonly Draft[], scale: number) {
    const gap = gapPx / scale
    const feet: Footprint[] = []
    const centres: Point[] = []
    const bounds: Bounds = { left: 0, right: 0, top: 0, bottom: 0 }
    for (const draft of list) {
      const { k, R } = footprint(draft, scale)
      const at = place(feet, R, gap, aspect)
      feet.push({ x: at.x, y: at.y, R })
      centres.push({ x: at.x, y: at.y + k })
      bounds.left = Math.min(bounds.left, at.x - R)
      bounds.right = Math.max(bounds.right, at.x + R)
      bounds.top = Math.min(bounds.top, at.y - R)
      bounds.bottom = Math.max(bounds.bottom, at.y + R)
    }
    return { centres, bounds }
  }

  const { centres, bounds } = packed
  const offsetX = width / 2 - ((bounds.left + bounds.right) / 2) * cell
  const offsetY = packHeight / 2 - ((bounds.top + bounds.bottom) / 2) * cell
  const positions = new Map<string, Point>()
  const groups: ClusterGroup[] = []

  drafts.forEach((draft, at) => {
    const centre = centres[at] ?? { x: 0, y: 0 }
    const x = offsetX + centre.x * cell
    const y = offsetY + centre.y * cell
    draft.members.forEach((id, i) => {
      const radius = i === 0 ? 0 : SUNFLOWER * Math.sqrt(i + SUNFLOWER_OFFSET)
      const angle = i * GOLDEN_ANGLE
      positions.set(id, {
        x: x + Math.cos(angle) * radius * cell,
        y: y + Math.sin(angle) * radius * cell,
      })
    })
    const r = draft.r * cell
    groups.push({
      key: draft.key,
      members: draft.members,
      anchors: draft.anchors,
      x,
      y,
      r,
      labelX: x,
      labelY: y - r - 5,
      labelAnchor: 'middle',
    })
  })

  // Reading order: rows by the circle's top edge, banded so circles that are
  // side by side read left to right rather than by a pixel of height.
  // Rows laid out in a meaningful order are already in reading order.
  const band = Math.max(...groups.map((g) => g.r), 1)
  if (!meaning) groups.sort(
    (a, b) =>
      Math.floor((a.y - a.r) / band) - Math.floor((b.y - b.r) / band) || a.x - b.x || compareText(a.key, b.key),
  )

  if (loose) {
    const r = 9
    const x = margin + r
    const y = height - strip / 2 - Math.min(margin, 8) / 2
    positions.set(GROUP_LOOSE, { x, y })
    groups.push({
      key: GROUP_LOOSE,
      members: [],
      anchors: folding.loose.length,
      x,
      y,
      r,
      labelX: x + r + 6,
      labelY: y + 4,
      labelAnchor: 'start',
    })
  }

  return { positions, groups, groupOf: assigned, cell, width, height }
}

type Bounds = { left: number; right: number; top: number; bottom: number }

/**
 * The best free spot for a circle of radius `R`. Candidates are tangent to two
 * placed circles, or to one at sixteen angles. Each is scored by the picture it
 * would leave: the size of the bounding box measured against the box's aspect
 * (which is what decides how large everything can be drawn), then — a small
 * second term — aspect-weighted distance from the middle, so ties stay compact.
 * The first circle goes at the origin.
 */
function place(feet: readonly Footprint[], R: number, gap: number, aspect: number): Point {
  if (feet.length === 0) return { x: 0, y: 0 }
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const f of feet) {
    left = Math.min(left, f.x - f.R)
    right = Math.max(right, f.x + f.R)
    top = Math.min(top, f.y - f.R)
    bottom = Math.max(bottom, f.y + f.R)
  }
  const score = (p: Point) => {
    const w = Math.max(right, p.x + R) - Math.min(left, p.x - R)
    const h = Math.max(bottom, p.y + R) - Math.min(top, p.y - R)
    return Math.max(w / aspect, h) + 0.05 * Math.sqrt(p.x * p.x + aspect * aspect * p.y * p.y)
  }
  const free = (p: Point) =>
    feet.every((f) => Math.hypot(p.x - f.x, p.y - f.y) >= f.R + R + gap - 1e-7)

  let best: Point | undefined
  let bestScore = Infinity
  const consider = (p: Point) => {
    const s = score(p)
    if (s < bestScore - 1e-9 && free(p)) {
      best = p
      bestScore = s
    }
  }

  for (let i = 0; i < feet.length; i++) {
    const a = feet[i]
    if (!a) continue
    for (let step = 0; step < 16; step++) {
      const angle = (step / 16) * Math.PI * 2
      const d = a.R + R + gap
      consider({ x: a.x + Math.cos(angle) * d, y: a.y + Math.sin(angle) * d })
    }
    for (let j = i + 1; j < feet.length; j++) {
      const b = feet[j]
      if (!b) continue
      for (const p of tangentTo(a, b, R + gap)) consider(p)
    }
  }
  // Unreachable in practice (the sixteen angles round the last circle always
  // include a free one far enough out), but a placement must never fail.
  return best ?? { x: 0, y: Math.max(...feet.map((f) => f.y + f.R)) + R + gap }
}

/** The two points at distance `a.R + add` from `a` and `b.R + add` from `b`. */
function tangentTo(a: Footprint, b: Footprint, add: number): Point[] {
  const ra = a.R + add
  const rb = b.R + add
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d === 0 || d > ra + rb || d < Math.abs(ra - rb)) return []
  const along = (ra * ra - rb * rb + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, ra * ra - along * along))
  const mx = a.x + (dx * along) / d
  const my = a.y + (dy * along) / d
  return [
    { x: mx + (dy * h) / d, y: my - (dx * h) / d },
    { x: mx - (dy * h) / d, y: my + (dx * h) / d },
  ]
}

/* ------------------------------- focus layout ------------------------------ */

/**
 * More neighbours than this makes a record a HUB: a role every application is,
 * a keyword half of them carry. Two steps out, the focus view does not walk
 * through a hub — that is what turned it into a starburst of a hundred lines —
 * it draws the hub with a count ("Researcher · 99 applications") and "Expand"
 * opens it.
 */
export const HUB_DEGREE = 12
/** A hub's neighbours drawn before the rest become one "+N more" item… */
export const HUB_SHOWN = 36
/** …once there are more than this many. */
export const HUB_LIST_MAX = 40
/** Prefix of the "+N more" item's id; the rest of the id is the hub's. */
export const MORE_PREFIX = '@more:'
/** The widest arc one record's neighbours fan out over behind it: a third of the circle. */
const SECTOR_ARC = (2 * Math.PI) / 3

export type FocusOptions = {
  readonly width: number
  readonly height: number
  /**
   * How many hops out from the centre to draw. Default 2 — or 1 when the centre
   * is itself a hub, whose neighbours' neighbours would be most of the store.
   */
  readonly hops?: number
  /**
   * Records whose neighbours are drawn as well, one ring further out, whatever
   * `hops` says — "Expand" on a neighbour. This is also what opens a hub.
   */
  readonly expanded?: Iterable<string>
  /** At most this many records in all; the outermost rings are cut first. Default 360. */
  readonly maxNodes?: number
  /** Order round a ring, and inside one hub's sector. Default: type, label, id. */
  readonly order?: (a: ViewNode, b: ViewNode) => number
  /** Room kept outside the outer ring for labels. Default 56. */
  readonly margin?: number
  /** The largest the spacing between neighbours on a ring may grow to. Default 44. */
  readonly maxCell?: number
  /** Neighbour count above which a record is a hub. Default `HUB_DEGREE`. */
  readonly hubDegree?: number
}

export type FocusLayout = {
  readonly centre: string
  /** Every drawn record, plus one `MORE_PREFIX + hub` item per capped hub. */
  readonly positions: ReadonlyMap<string, Point>
  /** Hop count from the centre for every drawn record (0 for the centre). */
  readonly hop: ReadonlyMap<string, number>
  /** Drawn record → the record one ring in that it was reached through. */
  readonly parentOf: ReadonlyMap<string, string>
  /** Radius of each ring's middle, in output units, innermost first — for faint guides. */
  readonly rings: readonly { hop: number; r: number }[]
  /** The input edges whose two ends are both drawn. */
  readonly edges: readonly ViewEdge[]
  /**
   * Hubs drawn but not walked through → their neighbours that are not drawn.
   * The caller labels the hub with these counted ("· 99 applications").
   */
  readonly collapsed: ReadonlyMap<string, readonly string[]>
  /** `MORE_PREFIX + hub` → the hub, and the neighbours the item stands for, in order. */
  readonly more: ReadonlyMap<string, { readonly hub: string; readonly ids: readonly string[] }>
  /** Records within reach that the `maxNodes` cap left out (not counting hubs and "more"). */
  readonly omitted: number
  readonly cell: number
  /** Where the centre record is drawn — the middle of the box, or the top of a fan. */
  readonly x: number
  readonly y: number
}

/**
 * One record at the centre, its neighbours on a ring round it, theirs on the
 * next ring out — the "what is this connected to" view.
 *
 * Ring 1 goes round the whole circle in `order`. Every outer ring is laid out
 * in SECTORS: each record's neighbours fan out in an arc behind it, as close to
 * its angle as spacing allows, rather than spreading round the whole circle —
 * so an expanded hub's hundred applications sit in a wedge behind it, sorted,
 * instead of drawing a hundred lines across the picture. A ring that would
 * crowd is split into staggered tracks, so spacing holds at any size.
 *
 * Hubs (`hubDegree`) are not walked through two steps out unless expanded. A
 * hub that IS walked (the centre, or expanded) with more than `HUB_LIST_MAX`
 * neighbours draws the first `HUB_SHOWN` and one "+N more" item for the rest.
 * `maxNodes` cuts the outermost ring last of all (children of expanded records
 * kept first) and says how many it cut.
 */
export function focusLayout(graph: ViewGraph, centreId: string, options: FocusOptions): FocusLayout {
  const { width, height } = options
  const maxNodes = options.maxNodes ?? 360
  const order = options.order ?? defaultOrder
  const margin = options.margin ?? 56
  const maxCell = options.maxCell ?? 44
  const hubDegree = options.hubDegree ?? HUB_DEGREE
  const expanded = new Set(options.expanded ?? [])
  const adj = adjacency(graph)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const isHub = (id: string) => (adj.get(id)?.length ?? 0) > hubDegree
  const hops = options.hops ?? (isHub(centreId) ? 1 : 2)

  const empty: FocusLayout = {
    centre: centreId,
    positions: new Map(),
    hop: new Map(),
    parentOf: new Map(),
    rings: [],
    edges: [],
    collapsed: new Map(),
    more: new Map(),
    omitted: 0,
    cell: maxCell,
    x: width / 2,
    y: height / 2,
  }
  if (!byId.has(centreId)) return empty

  /** May the walk go on through `from` to ring `k`? */
  const walks = (from: string, k: number) =>
    !from.startsWith(MORE_PREFIX) &&
    (k <= hops || expanded.has(from)) &&
    (k < 2 || !isHub(from) || expanded.has(from))

  const hop = new Map<string, number>([[centreId, 0]])
  const parentOf = new Map<string, string>()
  const more = new Map<string, { hub: string; ids: string[] }>()
  const listed = new Set<string>()
  const rings: string[][] = [[centreId]]
  let budget = maxNodes - 1

  for (let k = 1; budget > 0; k++) {
    const inner = rings[k - 1] ?? []
    const reached: { id: string; parent: string; boosted: boolean }[] = []
    const seen = new Set<string>()
    for (const from of inner) {
      if (!walks(from, k)) continue
      const children: ViewNode[] = []
      for (const to of adj.get(from) ?? []) {
        if (hop.has(to) || seen.has(to) || listed.has(to)) continue
        const node = byId.get(to)
        if (!node) continue
        seen.add(to)
        children.push(node)
      }
      children.sort(order)
      const boosted = expanded.has(from)
      let shown = children
      if (isHub(from) && children.length > HUB_LIST_MAX) {
        shown = children.slice(0, HUB_SHOWN)
        const rest = children.slice(HUB_SHOWN).map((n) => n.id)
        for (const id of rest) listed.add(id)
        more.set(MORE_PREFIX + from, { hub: from, ids: rest })
      }
      for (const node of shown) reached.push({ id: node.id, parent: from, boosted })
      if (more.has(MORE_PREFIX + from) && shown !== children) {
        reached.push({ id: MORE_PREFIX + from, parent: from, boosted })
      }
    }
    if (reached.length === 0) break

    let ring = reached
    if (ring.length > budget) {
      // Children of an expanded record are what was asked for; keep them first.
      const keep = new Set(
        [...ring]
          .sort((a, b) => Number(b.boosted) - Number(a.boosted))
          .slice(0, Math.max(0, budget))
          .map((r) => r.id),
      )
      ring = ring.filter((r) => keep.has(r.id))
    }
    budget -= ring.length
    for (const r of ring) {
      hop.set(r.id, k)
      parentOf.set(r.id, r.parent)
    }
    // A "+N more" item the budget cut takes its records with it: they are no
    // longer behind any item, so they go back to being counted in `omitted`
    // rather than vanishing from the picture and from every count.
    for (const [id, entry] of more) {
      if (hop.has(id)) continue
      for (const x of entry.ids) listed.delete(x)
      more.delete(id)
    }
    rings.push(ring.map((r) => r.id))
  }

  // Hubs drawn but not walked through, and what they stand for.
  const collapsed = new Map<string, string[]>()
  for (const ring of rings) {
    for (const id of ring) {
      const k = hop.get(id) ?? 0
      if (id.startsWith(MORE_PREFIX) || !isHub(id) || walks(id, k + 1)) continue
      const hidden = (adj.get(id) ?? []).filter((other) => !hop.has(other))
      if (hidden.length > 0) collapsed.set(id, hidden)
    }
  }

  // What was within reach by the same rules and is not drawn, listed, or
  // behind a hub — what the `maxNodes` cap alone cost.
  let omitted = 0
  {
    const reach = new Set<string>([centreId])
    let frontier = [centreId]
    for (let k = 1; frontier.length > 0; k++) {
      const next: string[] = []
      for (const from of frontier) {
        if (!walks(from, k)) continue
        for (const to of adj.get(from) ?? []) {
          if (reach.has(to)) continue
          reach.add(to)
          next.push(to)
        }
      }
      frontier = next
    }
    for (const id of reach) if (!hop.has(id) && !listed.has(id)) omitted += 1
  }

  // Natural units: one cell between neighbours on a track.
  const TRACK_GAP = 1.1
  const RING_GAP = 2.6
  const positions = new Map<string, Point>([[centreId, { x: 0, y: 0 }]])
  const angleOf = new Map<string, number>([[centreId, -Math.PI / 2]])
  const ringRadii: { hop: number; r: number }[] = []
  let outer = 0

  // A hub at the centre fans its neighbours out in a half circle below it,
  // like a tree's first level, rather than a full ring of spokes.
  const fan = isHub(centreId)

  rings.forEach((walked, k) => {
    if (k === 0) return
    // An outer ring in the order of its parents' angles, so sectors are pushed
    // apart the way the angles run. Ring 1 runs either way — up round the full
    // circle, but DOWN across a hub's fan (left to right is π towards 0) — and
    // without this the families of a fan's two expanded neighbours swap sides. Stable, so a ring
    // already in angle order (every ring off a full circle) is unchanged.
    const ids =
      k === 1
        ? walked
        : walked
            .map((id, j) => ({ id, j, a: angleOf.get(parentOf.get(id) ?? centreId) ?? 0 }))
            .sort((x, y) => x.a - y.a || x.j - y.j)
            .map((x) => x.id)
    const m = ids.length
    let family = 0
    if (k > 1) {
      const sizes = new Map<string, number>()
      for (const id of ids) {
        const p = parentOf.get(id) ?? centreId
        sizes.set(p, (sizes.get(p) ?? 0) + 1)
      }
      family = Math.max(0, ...sizes.values())
    }
    // Far enough out that the biggest family fits its arc in two tracks: an
    // opened hub's neighbours stand apart instead of crowding round it.
    const base = Math.max(
      outer + RING_GAP,
      k === 1 ? 3 : 0,
      k === 1 && fan ? (m * 1.08) / (Math.PI * 2) : 0,
      family / (SECTOR_ARC * 2),
    )
    // Enough tracks for the ring to go round once (half round, for a fan) —
    // and, on outer rings, for the largest family to fit a third of the circle
    // behind its parent, so an opened hub is a wedge rather than a ring.
    const tracks = Math.max(
      1,
      Math.ceil((m * 1.08) / ((k === 1 && fan ? 1 : 2) * Math.PI * base)),
      Math.ceil(family / (base * SECTOR_ARC)),
    )
    const step = 1 / base / tracks
    const angles =
      k === 1
        ? fan
          ? fanAngles(m, tracks)
          : evenAngles(m, tracks)
        : sectorAngles(ids, step, base, tracks)
    ids.forEach((id, j) => {
      const angle = angles[j] ?? 0
      const r = base + (j % tracks) * TRACK_GAP
      angleOf.set(id, angle)
      positions.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    })
    const last = base + (tracks - 1) * TRACK_GAP
    ringRadii.push({ hop: k, r: (base + last) / 2 })
    outer = last
  })

  /** Ring 1 round a hub: slots across the lower half circle, left to right. */
  function fanAngles(m: number, tracks: number): number[] {
    const slots = Math.ceil(m / tracks) * tracks
    return Array.from({ length: m }, (_, j) => Math.PI - (Math.PI * (j + 0.5)) / slots)
  }

  /** Ring 1: slots round the whole circle from the top, a whole number of turns of the tracks. */
  function evenAngles(m: number, tracks: number): number[] {
    const slots = Math.ceil(m / tracks) * tracks
    return Array.from({ length: m }, (_, j) => -Math.PI / 2 + (2 * Math.PI * j) / slots)
  }

  /**
   * Outer rings: each record's neighbours centred on its angle, `step` apart,
   * then pushed apart along the circle where sectors meet — the least movement
   * that keeps every two neighbours `step` apart. If the whole ring cannot
   * fit that way it falls back to even slots in the same order.
   */
  function sectorAngles(ids: readonly string[], step: number, base: number, tracks: number): number[] {
    const m = ids.length
    const counts = new Map<string, number>()
    for (const id of ids) {
      const p = parentOf.get(id) ?? centreId
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const want: number[] = []
    for (const id of ids) {
      const p = parentOf.get(id) ?? centreId
      const n = counts.get(p) ?? 1
      const j = seen.get(p) ?? 0
      seen.set(p, j + 1)
      want.push((angleOf.get(p) ?? 0) + (j - (n - 1) / 2) * step)
    }
    // Unwrap into one increasing run, then push forward and centre the push.
    const run: number[] = []
    for (const [j, a] of want.entries()) {
      let v = a
      const prev = run[j - 1]
      if (prev !== undefined) {
        while (v < prev - Math.PI) v += 2 * Math.PI
        while (v > prev + Math.PI) v -= 2 * Math.PI
      }
      run.push(v)
    }
    const pushed: number[] = []
    for (const [j, v] of run.entries()) {
      const prev = pushed[j - 1]
      pushed.push(prev === undefined ? v : Math.max(v, prev + step))
    }
    const shift = pushed.reduce((sum, v, j) => sum + ((run[j] ?? v) - v), 0) / Math.max(1, m)
    const span = (pushed[m - 1] ?? 0) - (pushed[0] ?? 0)
    // A full arc between the last and the first, so neither track meets itself.
    if (span > 2 * Math.PI - step * tracks - 1e-9 || !(base > 0)) {
      const slots = Math.ceil(m / tracks) * tracks
      const start = run[0] ?? -Math.PI / 2
      return Array.from({ length: m }, (_, j) => start + (2 * Math.PI * j) / slots)
    }
    return pushed.map((v) => v + shift)
  }

  // Fitted by what is drawn, not by the outer radius: a fan, or rings that
  // are mostly one wedge, use the box rather than centring an empty circle.
  let left = -1
  let right = 1
  let top = -1
  let bottom = 1
  for (const p of positions.values()) {
    left = Math.min(left, p.x)
    right = Math.max(right, p.x)
    top = Math.min(top, p.y)
    bottom = Math.max(bottom, p.y)
  }
  // A ring view keeps the record in the middle of the box, as far as its
  // furthest neighbour on each axis allows; a fan is centred on its bounds.
  const vMargin = Math.min(margin, 28)
  if (!fan) {
    const spanX = Math.max(-left, right)
    const spanY = Math.max(-top, bottom)
    left = -spanX
    right = spanX
    top = -spanY
    bottom = spanY
  }
  const cell = Math.min(
    maxCell,
    (width - 2 * margin) / (right - left),
    (height - 2 * vMargin) / (bottom - top),
  )
  const cx = width / 2 - ((left + right) / 2) * cell
  const cy = height / 2 - ((top + bottom) / 2) * cell
  const out = new Map<string, Point>()
  for (const [id, p] of positions) out.set(id, { x: cx + p.x * cell, y: cy + p.y * cell })

  const edges = graph.edges.filter((e) => e.from !== e.to && out.has(e.from) && out.has(e.to))
  return {
    centre: centreId,
    positions: out,
    hop,
    parentOf,
    // No guide circles round a fan: they would be mostly empty arcs.
    rings: fan ? [] : ringRadii.map((ring) => ({ hop: ring.hop, r: ring.r * cell })),
    edges,
    collapsed,
    more,
    omitted,
    cell,
    x: cx,
    y: cy,
  }
}

/* -------------------------------- satellites ------------------------------- */

/**
 * Seats for `count` records unfolded round a host at `around` — the overview's
 * "selecting the parent unfolds them". A ring just outside the host's radius,
 * then further rings out as needed, each spaced `spacing` apart along the arc,
 * starting at the top and going clockwise.
 */
export function satellites(
  count: number,
  around: Point,
  options: { readonly radius: number; readonly spacing: number },
): Point[] {
  const out: Point[] = []
  let r = options.radius + options.spacing * 1.3
  let left = count
  while (left > 0) {
    const capacity = Math.max(6, Math.floor((2 * Math.PI * r) / options.spacing))
    const here = Math.min(left, capacity)
    for (let j = 0; j < here; j++) {
      const angle = -Math.PI / 2 + (2 * Math.PI * j) / here
      out.push({ x: around.x + Math.cos(angle) * r, y: around.y + Math.sin(angle) * r })
    }
    left -= here
    r += options.spacing * 1.1
  }
  return out
}
