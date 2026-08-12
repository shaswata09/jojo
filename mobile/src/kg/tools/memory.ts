/**
 * L3 — the two admin tools.
 *
 * Both are `undoable: false`. That is not an oversight: they already go through
 * a confirmation dialog rather than an undo toast (`pendingCopy` in
 * `components/settings/data-confirm-copy.tsx`), and
 * journalling them would break that contract and write one entry holding every
 * record in the store. The runtime enforces it on the undo STACK rather than on
 * the journal, because `repo.commit` is the only path from a transaction buffer
 * to the durable op list — and after a reset no earlier before-image is safe to
 * replay anyway.
 *
 * `memory.reset` compiles `src/data/*` into nodes and edges. §2 of the
 * architecture names this the one tool allowed to import the fixtures, and the
 * layer checker allows it here for that reason.
 *
 * ---- READ THIS BEFORE CHANGING A FIXTURE ----
 * `repo/seed.ts` has a `seedToGraph()` doing the same compilation for the
 * first-run boot path, where no runtime exists yet. Two compilers over one set
 * of fixtures is the shape of R-1: a field added to `data/seed.ts` gets picked
 * up by whichever one the author happened to open, and the demo store then
 * differs depending on whether it arrived by first run or by pressing "Demo
 * data". They must be reconciled into one before Wave 2 — the cheap fix is to
 * let `tools/` import `repo/seed`, which is one line in
 * `scripts/check-layers.mjs`'s allowlist.
 *
 * `memory.import` is deliberately absent. The catalogue marks it new, and what
 * it replays is the envelope `useStoreAdmin().exportJSON` writes — a format the
 * React layer defines and which does not exist yet. An importer written against
 * a guess at that format is a data-loss bug with a confirmation dialog in front
 * of it.
 *
 * `memory.undo` / `memory.redo` are not registry tools either. They are
 * `runtime.undo()` and `runtime.redo()`: a tool runs inside a transaction and
 * has no access to the journal, so a tool that reverted an entry would have to
 * reach for the repository singleton the layer rule exists to forbid. Binding
 * them to ⌘Z and the palette is Wave 3.
 */

import { seedLabels, seedLabelsByRecord } from '@/data/labels'
import { seedProfile } from '@/data/profile'
import { matches, pipelines, savedPostings } from '@/data/scout'
import { applications } from '@/data/seed'
import { timeline } from '@/data/timeline'
import { snippets, vaultFiles, vaultLinks } from '@/data/vault'
import type { Instant, NodeId, NodePropsByType, SluggedType, StoredNode } from '@/kg/core/model'
import { s } from '@/kg/core/schema'
import { defineTool } from './tool'
import type { ToolContext } from './tool'
import { profileNode } from './profile'

/* ---------------------------------- clear --------------------------------- */

/** Everything the user can create. Keywords and the profile are handled apart. */
const RECORD_TYPES = [
  'application',
  'organisation',
  'timelineItem',
  'link',
  'file',
  'snippet',
  'posting',
  'match',
  'pipeline',
] as const

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

/**
 * The seed's `daysAgo` as a real instant.
 *
 * `daysAgo` was a stored count, reset to 0 on every edit, and correct only
 * because a reload wiped the store. Rebasing it against the transaction's own
 * clock is also what stops a demo loaded in 2027 looking abandoned.
 */
const agoOf = (now: Instant, days: number): Instant =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString()

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
    for (const keyword of ctx.memory.ofType('keyword')) ctx.tx.del(keyword.id)

    /**
     * The one cast in this file, over an object built from a fixture the
     * compiler has already checked field by field. TypeScript cannot see that
     * `{ ...props, slug }` reconstitutes `NodePropsByType[T]` for a generic `T`.
     */
    const put = <T extends SluggedType>(
      type: T,
      slugFrom: string,
      props: Omit<NodePropsByType[T], 'slug'>,
    ): NodeId => {
      const id = ctx.newId(type)
      ctx.tx.put({
        id,
        type,
        props: { ...props, slug: ctx.mintSlug(type, slugFrom) },
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as StoredNode<T>)
      return id
    }

    /* keywords, first: the applications below are tagged with them. */
    const keywordIds = new Map<string, NodeId>()
    for (const label of seedLabels) {
      keywordIds.set(label.id, put('keyword', label.name, { name: label.name, tone: label.tone }))
    }

    /* applications, each with its organisation. */
    const appIds = new Map<string, NodeId>()
    for (const a of applications) {
      const id = put('application', a.org, {
        role: a.role,
        note: a.note,
        roleTag: a.roleTag,
        stage: a.stage,
        lastAction: a.lastAction,
        lastActionAt: agoOf(ctx.now, a.daysAgo),
        ...(a.flagged === undefined ? {} : { flagged: a.flagged }),
        ...(a.source === undefined ? {} : { source: a.source }),
        ...(a.location === undefined ? {} : { location: a.location }),
        ...(a.comp === undefined ? {} : { comp: a.comp }),
        ...(a.url === undefined ? {} : { url: a.url }),
        ...(a.appliedOn === undefined ? {} : { appliedOn: a.appliedOn }),
        ...(a.submittedOn === undefined ? {} : { submittedOn: a.submittedOn }),
        ...(a.firstReplyOn === undefined ? {} : { firstReplyOn: a.firstReplyOn }),
        ...(a.outcome === undefined ? {} : { outcome: a.outcome }),
        ...(a.offer === undefined ? {} : { offer: a.offer }),
      })
      appIds.set(a.id, id)
      ctx.tx.link(id, 'AT', ctx.call('org.ensure', { name: a.org }))
    }

    const under = (id: NodeId, rel: 'ABOUT' | 'FILED_UNDER', applicationId?: string) => {
      const target = applicationId === undefined ? undefined : appIds.get(applicationId)
      if (target) ctx.tx.link(id, rel, target)
    }

    /* everything that can point at an application. */
    const itemIds = new Map<string, NodeId>()
    for (const i of timeline) {
      const id = put('timelineItem', i.title, {
        title: i.title,
        date: i.date,
        kind: i.kind,
        urgency: i.urgency,
        remind: i.remind,
        ...(i.detail === undefined ? {} : { detail: i.detail }),
        ...(i.note === undefined ? {} : { note: i.note }),
        ...(i.startMins === undefined ? {} : { startMins: i.startMins }),
        ...(i.durationMins === undefined ? {} : { durationMins: i.durationMins }),
        // `null` is dropped, not stored: it was the reducer's spelling of
        // "reopened", and it survives a structured clone as a present key.
        ...(i.completedOn ? { completedOn: i.completedOn } : {}),
        ...(i.location === undefined ? {} : { location: i.location }),
        ...(i.joinUrl === undefined ? {} : { joinUrl: i.joinUrl }),
      })
      itemIds.set(i.id, id)
      under(id, 'ABOUT', i.applicationId)
    }

    const linkIds = new Map<string, NodeId>()
    for (const l of vaultLinks) {
      const id = put('link', l.title, {
        title: l.title,
        url: l.url,
        category: l.category,
        savedOn: l.savedOn,
        ...(l.note === undefined ? {} : { note: l.note }),
      })
      linkIds.set(l.id, id)
      under(id, 'FILED_UNDER', l.applicationId)
    }

    const fileIds = new Map<string, NodeId>()
    for (const f of vaultFiles) {
      const id = put('file', f.name, {
        name: f.name,
        kind: f.kind,
        bucket: f.bucket,
        size: f.size,
        savedOn: f.savedOn,
        ...(f.note === undefined ? {} : { note: f.note }),
      })
      fileIds.set(f.id, id)
      under(id, 'FILED_UNDER', f.applicationId)
    }

    const snippetIds = new Map<string, NodeId>()
    for (const sn of snippets) {
      const id = put('snippet', sn.title, { title: sn.title, tag: sn.tag, body: sn.body })
      snippetIds.set(sn.id, id)
      under(id, 'FILED_UNDER', sn.applicationId)
    }

    /* scout. `linked` is not stored — the BECAME edge below IS that boolean. */
    const pipelineIds = new Map<string, NodeId>()
    for (const p of pipelines) {
      pipelineIds.set(
        p.id,
        put('pipeline', p.name, {
          name: p.name,
          source: p.source,
          schedule: p.schedule,
          filter: p.filter,
          enabled: p.enabled,
        }),
      )
    }

    for (const p of savedPostings) {
      const id = put('posting', p.title, {
        title: p.title,
        url: p.url,
        savedOn: p.savedOn,
        size: p.size,
      })
      const app = p.applicationId === undefined ? undefined : appIds.get(p.applicationId)
      if (app) ctx.tx.link(id, 'BECAME', app)
    }

    for (const mt of matches) {
      const id = put('match', mt.role, { role: mt.role, detail: mt.detail, fit: mt.fit })
      const app = mt.applicationId === undefined ? undefined : appIds.get(mt.applicationId)
      if (app) ctx.tx.link(id, 'BECAME', app)
    }

    /*
     * Keyword edges. The fixture keys applications as 'app:rice' and everything
     * else bare, because six records in the seed answer to 'stripe' and only the
     * application has keywords on it. That ambiguity is exactly what the
     * type-prefixed ids delete — this loop is the last place it is read.
     */
    const recordOf = (key: string): NodeId | undefined => {
      if (key.startsWith('app:')) return appIds.get(key.slice(4))
      return itemIds.get(key) ?? linkIds.get(key) ?? fileIds.get(key) ?? snippetIds.get(key)
    }

    for (const [key, ids] of Object.entries(seedLabelsByRecord)) {
      const record = recordOf(key)
      if (!record) continue
      for (const labelId of ids) {
        const keyword = keywordIds.get(labelId)
        if (keyword) ctx.tx.link(keyword, 'TAGS', record)
      }
    }

    /* profile. */
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, seedProfile())
  },

  describe: () => ({
    title: 'Demo data loaded',
    description: 'Twelve applications, a timeline and a full vault.',
  }),
})
