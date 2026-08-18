/**
 * L3 — the two admin tools.
 *
 * Both are `undoable: false`, and journalling them would write one entry holding
 * every record in the store. The runtime enforces it on the undo STACK rather
 * than on the journal, because `repo.commit` is the only path from a transaction
 * buffer to the durable op list — and after a reset no earlier before-image is
 * safe to replay anyway.
 *
 * ---- THE TWO COMPILERS ARE NOW ONE ----
 * `memory.reset` used to hold a SECOND compiler over the same fixture arrays,
 * beside `seedToGraph()` in `repo/seed.ts`. That is the shape of R-1, and it had
 * already drifted by the time anyone measured it: Wave 4 taught `seedToGraph` to
 * rebase every authored date by `seedOffset`, and this file never learned it, so
 * a demo loaded from here carried an offer that expired last spring while the
 * same fixtures loaded on a first run did not. The slugs differed too — minted
 * here from the display title, there from the fixture's own id — which made
 * `/applications/rice-research` a live deep link against one demo and a 404
 * against the other.
 *
 * So this tool calls `seedToGraph` and stages what it returns. `tools` is
 * allowed to import `repo/seed` by name in `check-layers.mjs`'s `allow` list,
 * beside `repo/repository` and `repo/journal`, and for the same reason: it is a
 * pure function over the fixtures, not a driver and not a singleton. There is
 * one compiler and the divergence is no longer representable — and this file is
 * no longer a `DATA_READERS` entry, so a third one cannot appear here without
 * failing lint.
 *
 * Settings does not come through here either way. `src/lib/data-set.ts` calls
 * `seedToGraph` + `repo.replaceAll` directly, for two reasons a tool cannot
 * answer: a tool's wipe is only as complete as `RECORD_TYPES` below and its
 * deletes queue behind the write queue, whereas `replaceAll` clears every object
 * store in one transaction; and a tool commit cannot write the `dataSet: 'empty'`
 * meta row D24 needs, because `land()` flips `dataSet` to 'user' on any write.
 *
 * WHAT REACHES THESE TWO. `memory.clear` is live — `useStoreAdmin().clearAll`,
 * called by web's `DataPanel` and mobile's `FirstRunChoice`. `memory.reset` has
 * no caller at all: `useStoreAdmin().reset` is never destructured, and the
 * palette does not reach it. This header used to claim both were ⌘K doors on the
 * grounds that neither is `internal`; that is false in both apps. `planToolForm`
 * in web's `components/common/tool-form.ts` returns null on `effect === 'admin'`
 * BEFORE it looks at `internal`, which is what `SpotlightSearch` and
 * `graph/GraphDetail` gate on, and mobile has no tool-running surface. Keep that
 * in mind before writing anything here that assumes a user can see it.
 *
 * `memory.import` is deliberately absent, but not for the reason recorded here
 * before. The envelope exists — `EXPORT_VERSION` and `exportJSON` in
 * `kg/react/use-admin.ts` — so "a format the React layer defines and which does
 * not exist yet" is out of date. The live blocker is the one `DataPanel`'s own
 * Import tooltip states: reading a backup needs a validator that can REFUSE a
 * file it does not understand. An importer written without one is a data-loss
 * bug with a confirmation dialog in front of it.
 *
 * `memory.undo` / `memory.redo` are not registry tools either. They are
 * `runtime.undo()` and `runtime.redo()`: a tool runs inside a transaction and
 * has no access to the journal, so a tool that reverted an entry would have to
 * reach for the repository singleton the layer rule exists to forbid. ⌘Z and ⇧⌘Z
 * reach them through `webHost.onUndoRequest` in `src/lib/host.ts`; the palette
 * never grew an entry for either, and because they are not tools it never will
 * by itself.
 */

import { NODE_TYPES } from '../core/model'
import type { NodeType, ProfileProps } from '../core/model'
import { s } from '../core/schema'
import { seedToGraph } from '../repo/seed'
import { defineTool } from './tool'
import type { ToolContext } from './tool'
import { profileNode } from './profile'

/* ---------------------------------- clear --------------------------------- */

/**
 * Everything a wipe walks, as `NODE_TYPES` minus the two handled apart.
 *
 * A subtraction rather than a list, because this list being SHORT is a silent
 * failure: `memory.clear`'s summary says "removes every record", and a twelfth
 * node type added to the model and not to a hand-written list here would leave
 * its rows behind under that sentence. `lib/data-set.ts`'s header names this exact
 * gap as one of the two reasons Settings stopped calling these tools —
 * *"'cleared' meant 'every record type we remembered to name is gone'"*. Written
 * this way, the model adds the type and the wipe already covers it.
 *
 * The exclusions are the two that are not "records the user creates":
 * a keyword is the user's own vocabulary and `memory.clear` keeps it (D14), and
 * the profile is a singleton that is blanked rather than deleted because the
 * page has to have something to render.
 */
const HANDLED_APART: ReadonlySet<string> = new Set<NodeType>(['keyword', 'profile'])

const RECORD_TYPES: readonly NodeType[] = NODE_TYPES.filter((type) => !HANDLED_APART.has(type))

function clearRecords(ctx: ToolContext) {
  for (const type of RECORD_TYPES) {
    for (const node of ctx.memory.ofType(type)) ctx.tx.del(node.id)
  }
}

export const memoryClear = defineTool({
  name: 'memory.clear',
  title: 'Empty the store',
  summary: 'Removes every record and blanks the profile. Keywords are kept.',
  effect: 'admin',
  touches: [...RECORD_TYPES, 'profile'],
  undoable: false,
  input: s.object({}),

  run(ctx) {
    clearRecords(ctx)
    // Blanked, not deleted: the profile is a singleton and the page has to have
    // something to render. Blanked at all because an app with no records must
    // not still be greeting a new reader with a stranger's name and email.
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, {
      text: {
        fullName: '',
        position: '',
        location: '',
        email: '',
        website: '',
        scholar: '',
        github: '',
        linkedin: '',
        targetRoles: '',
        regions: '',
      },
      matchTerms: [],
    })
    // Keywords survive. They are the user's own system and outlive any one set
    // of records — and the alternative is what the removed `store-context.ts`
    // describes from the other direction: a cleared store still reporting "Used
    // on 32 records" because the two halves were cleared by different code.
  },

  describe: () => ({
    title: 'Records cleared',
    description: 'Your keywords are still here.',
    tone: 'danger',
  }),
})

/* ---------------------------------- reset --------------------------------- */

export const memoryReset = defineTool({
  name: 'memory.reset',
  title: 'Load demo data',
  summary: 'Replaces everything with the demo records jojo ships with.',
  effect: 'admin',
  touches: [...RECORD_TYPES, 'keyword', 'profile'],
  undoable: false,
  input: s.object({}),

  run(ctx) {
    clearRecords(ctx)
    // Keywords too. `memory.clear` keeps the user's vocabulary (D14); a reset
    // replaces the store with the demo's, which has its own.
    for (const keyword of ctx.memory.ofType('keyword')) ctx.tx.del(keyword.id)

    // Compiled from the transaction's own instant, so the rebase and every
    // `createdAt` in the graph are read off one clock. `seedToGraph` also mints
    // its ids from it, exactly as `ctx.newId` would.
    const { nodes, edges } = seedToGraph(ctx.now)

    // Nodes first, or `tx.link` below rejects an edge whose ends are not in the
    // overlay yet — which is the same check that makes a corrupt edge
    // unrepresentable rather than a boot-time diagnostic.
    let seededProfile: ProfileProps | null = null
    for (const node of nodes) {
      // The one node this cannot put. A profile is a singleton the graph mints
      // on first write and `memory.clear` blanks rather than deletes, so putting
      // the seed's would leave two — and `profileNode` hands back whichever it
      // found first from then on.
      if (node.type === 'profile') {
        seededProfile = node.props
        continue
      }
      ctx.tx.put(node)
    }

    for (const edge of edges) ctx.tx.link(edge.from, edge.rel, edge.to, edge.props)

    if (seededProfile) ctx.tx.patch<'profile'>(profileNode(ctx).id, seededProfile)
  },

  describe: () => ({
    title: 'Demo data loaded',
    description: 'Twelve applications, a timeline and a full vault.',
  }),
})
