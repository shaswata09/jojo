import { createContext, useCallback, useContext, useMemo } from 'react'
import type { Dispatch } from 'react'
import { draftFromText, draftFromUrl } from '@/components/applications/draft-from'
import { emptyProfile, profileIsBlank, seedProfile } from '@/data/profile'
import type { Profile } from '@/data/profile'
import {
  matches as seedMatches,
  pipelines as seedPipelines,
  savedPostings as seedPostings,
} from '@/data/scout'
import type { Match, Pipeline, SavedPosting } from '@/data/scout'
import { SOURCES, STAGES, applications as seedApplications } from '@/data/seed'
import type { Application, OfferApplication, RoleTag, Stage } from '@/data/seed'
import {
  TODAY,
  addDays,
  bucketOf,
  compareItems,
  followUpsOf,
  timeline as seedTimeline,
} from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import {
  snippets as seedSnippets,
  vaultFiles as seedFiles,
  vaultLinks as seedLinks,
} from '@/data/vault'
import type { Snippet, VaultFile, VaultLink } from '@/data/vault'
import { refKey, slugify, uniqueId } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'

/**
 * Every record the user can create, edit or delete, in one reducer.
 *
 * One provider rather than four, because deleting an application has to reach
 * into collections it does not own: a reminder, a saved link and a captured
 * posting can all point at it. Split across providers that would be a write
 * spanning four reducers with no way to make it atomic, and an undo spanning
 * four separate restores.
 */
export type StoreState = {
  applications: Application[]
  timeline: TimelineItem[]
  links: VaultLink[]
  files: VaultFile[]
  snippets: Snippet[]
  postings: SavedPosting[]
  matches: Match[]
  pipelines: Pipeline[]
  /** The one member that is a record rather than a list. See `data/profile.ts`. */
  profile: Profile
}

/** The collections that take the same three edits and hold no cross-domain rules. */
type CollectionKey = 'links' | 'files' | 'snippets' | 'postings' | 'matches' | 'pipelines'
type CollectionRecord<K extends CollectionKey> = StoreState[K][number]
type CollectionDraft<K extends CollectionKey> = Omit<CollectionRecord<K>, 'id'>

/**
 * The collections that can point at an application. A pipeline is a saved
 * search over a job board — it names no record here, so deleting an application
 * has nothing to sweep in it and an undo has nothing to put back.
 */
type LinkedKey = Exclude<CollectionKey, 'pipelines'>

/** Every list in the store, for the passes that have to visit all of them. */
const LIST_KEYS = [
  'applications',
  'timeline',
  'links',
  'files',
  'snippets',
  'postings',
  'matches',
  'pipelines',
] as const satisfies readonly (keyof StoreState)[]

/** `lastAction` and `daysAgo` are stamped by `add`, so a caller never has to. */
export type ApplicationDraft = Omit<Application, 'id' | 'lastAction' | 'daysAgo'> &
  Partial<Pick<Application, 'lastAction' | 'daysAgo'>>

export type TimelineDraft = Omit<TimelineItem, 'id' | 'allDay' | 'remind' | 'urgency'> &
  Partial<Pick<TimelineItem, 'allDay' | 'remind' | 'urgency'>>

/**
 * Which records pointed at an application when it was deleted.
 *
 * Captured before the write so `restore` can put the edges back. Without it an
 * undo would return the application to an app where nothing references it any
 * more, which looks like a successful undo and is not one.
 */
export type ApplicationEdges = Record<'timeline' | LinkedKey, string[]>

export type StoreAction =
  | { type: 'application/add'; application: Application }
  | { type: 'application/update'; id: string; patch: Partial<Application> }
  | { type: 'application/remove'; id: string }
  | { type: 'application/restore'; application: Application; at: number; edges: ApplicationEdges }
  | { type: 'item/add'; item: TimelineItem }
  | { type: 'item/update'; id: string; patch: Partial<TimelineItem> }
  | { type: 'item/remove'; id: string }
  | { type: 'collection/add'; key: CollectionKey; record: { id: string }; at?: number }
  | { type: 'collection/update'; key: CollectionKey; id: string; patch: object }
  | { type: 'collection/remove'; key: CollectionKey; id: string }
  | { type: 'profile/update'; patch: Partial<Profile> }
  | { type: 'store/reset' }
  | { type: 'store/clear' }

/* --------------------------------- reducer -------------------------------- */

type Linked = { id: string; applicationId?: string }

const patched = <T extends { id: string }>(list: T[], id: string, patch: object): T[] =>
  list.map((r) => (r.id === id ? { ...r, ...patch } : r))

function inserted<T>(list: T[], record: T, at: number): T[] {
  const next = [...list]
  next.splice(at, 0, record)
  return next
}

const unlinked = <T extends Linked>(list: T[], appId: string): T[] =>
  list.map((r) => (r.applicationId === appId ? { ...r, applicationId: undefined } : r))

const relinked = <T extends Linked>(list: T[], ids: string[], appId: string): T[] =>
  ids.length === 0
    ? list
    : list.map((r) => (ids.includes(r.id) ? { ...r, applicationId: appId } : r))

/**
 * The five plain collections share one action carrying the key, so the branch
 * is written once. TypeScript cannot correlate `action.key` with the record
 * type through a computed spread, so the assertion is kept here and nowhere
 * else — every caller in this file goes through a typed wrapper.
 */
function withCollection(
  state: StoreState,
  key: CollectionKey,
  next: (list: { id: string }[]) => { id: string }[],
): StoreState {
  return { ...state, [key]: next(state[key]) } as StoreState
}

export function storeReducer(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'application/add':
      return { ...state, applications: [action.application, ...state.applications] }

    case 'application/update':
      return { ...state, applications: patched(state.applications, action.id, action.patch) }

    /**
     * Deleting an application UNLINKS, it never cascades.
     *
     * Every reminder, link, file, snippet and captured posting that pointed at
     * it loses the pointer and survives. The alternative — deleting them too —
     * would destroy work the user never named: the reference-letter tracker
     * filed under one application is a document in its own right, and a
     * confirmation dialog that says "delete Rice" cannot fairly be read as
     * consent to delete the four files someone spent an evening on.
     */
    case 'application/remove':
      return {
        ...state,
        applications: state.applications.filter((a) => a.id !== action.id),
        timeline: unlinked(state.timeline, action.id),
        links: unlinked(state.links, action.id),
        files: unlinked(state.files, action.id),
        snippets: unlinked(state.snippets, action.id),
        matches: unlinked(state.matches, action.id),
        // `linked` is the same edge rendered as a boolean; kept in step so the
        // Job scout list cannot claim a link to an application that is gone.
        postings: state.postings.map((p) =>
          p.applicationId === action.id ? { ...p, applicationId: undefined, linked: false } : p,
        ),
      }

    case 'application/restore': {
      const id = action.application.id
      return {
        ...state,
        applications: inserted(state.applications, action.application, action.at),
        timeline: relinked(state.timeline, action.edges.timeline, id),
        links: relinked(state.links, action.edges.links, id),
        files: relinked(state.files, action.edges.files, id),
        snippets: relinked(state.snippets, action.edges.snippets, id),
        matches: relinked(state.matches, action.edges.matches, id),
        postings: state.postings.map((p) =>
          action.edges.postings.includes(p.id) ? { ...p, applicationId: id, linked: true } : p,
        ),
      }
    }

    // Also the restore path: a timeline item's position is derived from its own
    // date and time, so putting one back is the same write as adding it.
    case 'item/add':
      return { ...state, timeline: [...state.timeline, action.item].sort(compareItems) }

    // Re-sorted because a patch may carry a new date — rescheduling is the most
    // common edit there is, and an unsorted rail reads as a rendering bug.
    case 'item/update':
      return {
        ...state,
        timeline: patched(state.timeline, action.id, action.patch).sort(compareItems),
      }

    case 'item/remove':
      return { ...state, timeline: state.timeline.filter((i) => i.id !== action.id) }

    case 'collection/add':
      return withCollection(state, action.key, (list) =>
        action.at === undefined
          ? [action.record, ...list]
          : inserted(list, action.record, action.at),
      )

    case 'collection/update':
      return withCollection(state, action.key, (list) => patched(list, action.id, action.patch))

    case 'collection/remove':
      return withCollection(state, action.key, (list) => list.filter((r) => r.id !== action.id))

    case 'profile/update':
      return { ...state, profile: { ...state.profile, ...action.patch } }

    case 'store/reset':
      return seedState()

    case 'store/clear':
      return emptyState()
  }
}

/* ------------------------------ initial state ----------------------------- */

/**
 * Copies of the seed arrays, never the arrays themselves. Every write here is
 * immutable, so the modules stay pristine and `reset` can hand them back.
 */
export function seedState(): StoreState {
  return {
    applications: [...seedApplications],
    timeline: [...seedTimeline],
    links: [...seedLinks],
    files: [...seedFiles],
    snippets: [...seedSnippets],
    postings: [...seedPostings],
    matches: [...seedMatches],
    pipelines: [...seedPipelines],
    profile: seedProfile(),
  }
}

export function emptyState(): StoreState {
  return {
    applications: [],
    timeline: [],
    links: [],
    files: [],
    snippets: [],
    postings: [],
    matches: [],
    pipelines: [],
    // Blank, not seeded: an app with no records must not still be carrying
    // someone's name and email in the profile fields.
    profile: emptyProfile(),
  }
}

/* --------------------------------- context -------------------------------- */

export type StoreContextValue = {
  state: StoreState
  /**
   * The state as of the last render, readable from a callback that has no
   * closure over it. Every callback below is declared with stable deps so it
   * can sit in a dependency array without churning, which rules out reading
   * `state` directly.
   */
  read: () => StoreState
  dispatch: Dispatch<StoreAction>
}

export const StoreContext = createContext<StoreContextValue | null>(null)

function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

/* ------------------------------- applications ----------------------------- */

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>

const idsPointingAt = (list: readonly Linked[], appId: string) =>
  list.filter((r) => r.applicationId === appId).map((r) => r.id)

export function useApplications() {
  const { state, read, dispatch } = useStore()
  const { labelIdsOf, setRecord, removeRecord } = useLabels()

  const all = state.applications

  const byId = useMemo(() => new Map(all.map((a) => [a.id, a])), [all])
  const get = useCallback((id: string) => byId.get(id), [byId])

  const add = useCallback(
    (draft: ApplicationDraft) => {
      const taken = read().applications.map((a) => a.id)
      const application: Application = {
        ...draft,
        id: uniqueId(slugify(draft.org), taken),
        lastAction: draft.lastAction ?? 'Draft created',
        daysAgo: draft.daysAgo ?? 0,
      }
      dispatch({ type: 'application/add', application })
      return application
    },
    [read, dispatch],
  )

  const update = useCallback(
    (id: string, patch: Partial<Application>) => {
      // Any edit counts as activity. `daysAgo` is what the recent feed and the
      // default sort read, so an edit that left it alone would sink the row the
      // user just touched to the bottom of the list.
      dispatch({ type: 'application/update', id, patch: { daysAgo: 0, ...patch } })
    },
    [dispatch],
  )

  /** Returns a true undo — the record, its position, and every edge it had. */
  const remove = useCallback(
    (id: string) => {
      const snapshot = read()
      const at = snapshot.applications.findIndex((a) => a.id === id)
      if (at === -1) return { restore: () => {} }
      const application = snapshot.applications[at]

      const edges: ApplicationEdges = {
        timeline: idsPointingAt(snapshot.timeline, id),
        links: idsPointingAt(snapshot.links, id),
        files: idsPointingAt(snapshot.files, id),
        snippets: idsPointingAt(snapshot.snippets, id),
        postings: idsPointingAt(snapshot.postings, id),
        matches: idsPointingAt(snapshot.matches, id),
      }

      // The label store still keys seeded records by bare id while `refKey`
      // spells the same edge 'app:stripe'. Both spellings can be live at once,
      // so both are swept — sweeping one would strand keywords on a record that
      // no longer exists, and they would reappear on the next id to reuse it.
      const keys = [refKey('app', id), id]
      const stashed = keys.map((key) => labelIdsOf(key))

      dispatch({ type: 'application/remove', id })
      keys.forEach(removeRecord)

      return {
        restore() {
          dispatch({ type: 'application/restore', application, at, edges })
          keys.forEach((key, i) => setRecord(key, stashed[i]))
        },
      }
    },
    [read, dispatch, labelIdsOf, setRecord, removeRecord],
  )

  const setStage = useCallback(
    (id: string, stage: Stage) =>
      update(id, { stage, lastAction: `Moved to ${STAGE_LABEL[stage]}` }),
    [update],
  )

  /**
   * The same posting, applied for again. Back to draft, and the offer, outcome
   * and dates are dropped: those belong to the attempt that earned them, and a
   * copy carrying someone else's offer is worse than no copy at all.
   */
  const duplicate = useCallback(
    (id: string) => {
      const snapshot = read()
      const source = snapshot.applications.find((a) => a.id === id)
      if (!source) return undefined

      const copy: Application = {
        ...source,
        id: uniqueId(
          slugify(source.org),
          snapshot.applications.map((a) => a.id),
        ),
        stage: 'draft',
        flagged: undefined,
        lastAction: 'Duplicated',
        daysAgo: 0,
        appliedOn: undefined,
        submittedOn: undefined,
        firstReplyOn: undefined,
        outcome: undefined,
        offer: undefined,
      }
      dispatch({ type: 'application/add', application: copy })
      return copy
    },
    [read, dispatch],
  )

  const stageCounts = useMemo(
    () =>
      STAGES.map((stage) => ({ ...stage, count: all.filter((a) => a.stage === stage.id).length })),
    [all],
  )

  const offers = useMemo(
    () => all.filter((a): a is OfferApplication => a.stage === 'offer' && a.offer !== undefined),
    [all],
  )

  const recent = useMemo(() => [...all].sort((a, b) => a.daysAgo - b.daysAgo), [all])

  // Every source stays in the list even at zero, so the breakdown's colours and
  // legend order hold still as applications move around.
  const sourceCounts = useMemo(
    () =>
      SOURCES.map((source) => ({ source, count: all.filter((a) => a.source === source).length })),
    [all],
  )

  return useMemo(
    () => ({
      all,
      byId,
      get,
      add,
      update,
      remove,
      setStage,
      duplicate,
      stageCounts,
      offers,
      recent,
      sourceCounts,
    }),
    [
      all,
      byId,
      get,
      add,
      update,
      remove,
      setStage,
      duplicate,
      stageCounts,
      offers,
      recent,
      sourceCounts,
    ],
  )
}

/* --------------------------------- timeline ------------------------------- */

export function useTimeline() {
  const { state, read, dispatch } = useStore()
  const all = state.timeline

  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all])
  const get = useCallback((id: string) => byId.get(id), [byId])

  const forApplication = useCallback(
    (appId: string) => all.filter((i) => i.applicationId === appId),
    [all],
  )

  const forDay = useCallback((iso: string) => all.filter((i) => i.date === iso), [all])

  // Matched on the 'YYYY-MM' prefix rather than by parsing. The year has to be
  // part of the test or October 2027 lists October 2026's deadlines, and an ISO
  // string compares correctly without ever becoming a Date.
  const forMonth = useCallback(
    (y: number, m: number) => {
      const prefix = `${y}-${String(m).padStart(2, '0')}`
      return all.filter((i) => i.date.startsWith(prefix))
    },
    [all],
  )

  const add = useCallback(
    (draft: TimelineDraft) => {
      const taken = read().timeline.map((i) => i.id)
      const item: TimelineItem = {
        ...draft,
        id: uniqueId(slugify(draft.title), taken),
        allDay: draft.allDay ?? draft.startMins === undefined,
        remind: draft.remind ?? false,
        urgency: draft.urgency ?? 'gray',
      }
      dispatch({ type: 'item/add', item })
      return item
    },
    [read, dispatch],
  )

  const update = useCallback(
    (id: string, patch: Partial<TimelineItem>) => dispatch({ type: 'item/update', id, patch }),
    [dispatch],
  )

  const remove = useCallback(
    (id: string) => {
      const item = read().timeline.find((i) => i.id === id)
      dispatch({ type: 'item/remove', id })
      return {
        restore() {
          if (item) dispatch({ type: 'item/add', item })
        },
      }
    },
    [read, dispatch],
  )

  const toggleDone = useCallback(
    (id: string) => {
      const item = read().timeline.find((i) => i.id === id)
      if (!item) return
      // Stamped with the seed's pinned today, not the wall clock: every bucket
      // and relative label in the app is measured against TODAY, so a real date
      // here would read as "Completed in 10 months".
      dispatch({
        type: 'item/update',
        id,
        patch: { completedOn: item.completedOn ? null : TODAY },
      })
    },
    [read, dispatch],
  )

  const snooze = useCallback(
    (id: string, days: number) => {
      const item = read().timeline.find((i) => i.id === id)
      if (!item) return
      // Counted from today when the item is already overdue, otherwise
      // "snooze a day" on something eight days late leaves it seven days late.
      const from = item.date < TODAY ? TODAY : item.date
      dispatch({ type: 'item/update', id, patch: { date: addDays(from, days) } })
    },
    [read, dispatch],
  )

  const reschedule = useCallback(
    (id: string, iso: string) => dispatch({ type: 'item/update', id, patch: { date: iso } }),
    [dispatch],
  )

  const reminders = useMemo(() => all.filter((i) => i.remind), [all])
  const overdue = useMemo(() => all.filter((i) => bucketOf(i, TODAY) === 'overdue'), [all])
  const today = useMemo(() => all.filter((i) => bucketOf(i, TODAY) === 'today'), [all])
  const upcoming = useMemo(() => all.filter((i) => bucketOf(i, TODAY) === 'upcoming'), [all])
  const followUps = useMemo(() => followUpsOf(all), [all])

  const thisWeek = useMemo(() => {
    const end = addDays(TODAY, 6)
    return all.filter((i) => !i.completedOn && i.date >= TODAY && i.date <= end)
  }, [all])

  return useMemo(
    () => ({
      all,
      get,
      forApplication,
      forDay,
      forMonth,
      add,
      update,
      remove,
      toggleDone,
      snooze,
      reschedule,
      reminders,
      overdue,
      today,
      upcoming,
      followUps,
      thisWeek,
    }),
    [
      all,
      get,
      forApplication,
      forDay,
      forMonth,
      add,
      update,
      remove,
      toggleDone,
      snooze,
      reschedule,
      reminders,
      overdue,
      today,
      upcoming,
      followUps,
      thisWeek,
    ],
  )
}

/* ------------------------- plain collections (CRUD) ----------------------- */

/**
 * Add, update and remove for one of the five plain collections.
 *
 * `nameOf` and `prefix` mint the id the way each seed list already spells it —
 * 'l-rice', 'f-cv', 's-bio-short' — so a record added in this session is
 * indistinguishable from one that shipped with the app.
 */
function useCollectionActions<K extends CollectionKey>(
  key: K,
  prefix: string,
  nameOf: (draft: CollectionDraft<K>) => string,
) {
  const { read, dispatch } = useStore()

  const add = useCallback(
    (draft: CollectionDraft<K>) => {
      const taken = (read()[key] as { id: string }[]).map((r) => r.id)
      const record = {
        ...draft,
        id: uniqueId(prefix + slugify(nameOf(draft)), taken),
      } as CollectionRecord<K>
      dispatch({ type: 'collection/add', key, record })
      return record
    },
    [key, prefix, nameOf, read, dispatch],
  )

  const update = useCallback(
    (id: string, patch: Partial<CollectionRecord<K>>) =>
      dispatch({ type: 'collection/update', key, id, patch }),
    [key, dispatch],
  )

  const remove = useCallback(
    (id: string) => {
      const list = read()[key] as { id: string }[]
      const at = list.findIndex((r) => r.id === id)
      const record = at === -1 ? undefined : list[at]
      dispatch({ type: 'collection/remove', key, id })
      return {
        restore() {
          if (record) dispatch({ type: 'collection/add', key, record, at })
        },
      }
    },
    [key, read, dispatch],
  )

  return [add, update, remove] as const
}

// Declared at module scope so the callbacks above keep a stable identity.
const linkName = (d: CollectionDraft<'links'>) => d.title
const fileName = (d: CollectionDraft<'files'>) => d.name
const snippetName = (d: CollectionDraft<'snippets'>) => d.title
const postingName = (d: CollectionDraft<'postings'>) => d.title
const matchName = (d: CollectionDraft<'matches'>) => d.role
const pipelineName = (d: CollectionDraft<'pipelines'>) => d.name

/**
 * Something saved now is saved on the seed's today, not the wall clock's.
 *
 * This used to be the frozen string 'just now', which meant a link you added
 * yourself was the one record in the vault whose age could never change — and
 * it sat next to rows reading '3 weeks ago' that could never change either.
 * Both are real ISO dates now and both go through `agoLabel`.
 */
const SAVED_NOW = TODAY

export function useVault() {
  const { state } = useStore()
  const [addLinkRecord, updateLink, removeLink] = useCollectionActions('links', 'l-', linkName)
  const [addFileRecord, updateFile, removeFile] = useCollectionActions('files', 'f-', fileName)
  const [addSnippet, updateSnippet, removeSnippet] = useCollectionActions(
    'snippets',
    's-',
    snippetName,
  )

  const addLink = useCallback(
    (draft: Omit<VaultLink, 'id' | 'savedOn'> & { savedOn?: string }) =>
      addLinkRecord({ ...draft, savedOn: draft.savedOn ?? SAVED_NOW }),
    [addLinkRecord],
  )

  const addFile = useCallback(
    (draft: Omit<VaultFile, 'id' | 'savedOn'> & { savedOn?: string }) =>
      addFileRecord({ ...draft, savedOn: draft.savedOn ?? SAVED_NOW }),
    [addFileRecord],
  )

  return useMemo(
    () => ({
      links: state.links,
      addLink,
      updateLink,
      removeLink,
      files: state.files,
      addFile,
      updateFile,
      removeFile,
      snippets: state.snippets,
      addSnippet,
      updateSnippet,
      removeSnippet,
    }),
    [
      state.links,
      addLink,
      updateLink,
      removeLink,
      state.files,
      addFile,
      updateFile,
      removeFile,
      state.snippets,
      addSnippet,
      updateSnippet,
      removeSnippet,
    ],
  )
}

/* ---------------------------------- scout --------------------------------- */

/**
 * Best guess from the posting's own wording, checked most specific first so
 * "Assistant professor, data science" does not come back as a Researcher.
 * A promotion dialog should offer this as a default and let the user correct it.
 */
function guessRoleTag(text: string): RoleTag {
  const t = text.toLowerCase()
  if (t.includes('lecturer')) return 'Lecturer'
  if (t.includes('postdoc')) return 'Postdoc'
  if (t.includes('professor')) return 'Assistant Professor'
  if (t.includes('scientist') || t.includes('research')) return 'Researcher'
  return 'ML Engineer'
}

export function useScout() {
  const { state, read } = useStore()
  const { add: addApplication } = useApplications()
  const [addMatch, updateMatch, removeMatch] = useCollectionActions('matches', 'm-', matchName)
  const [addPostingRecord, updatePosting, removePosting] = useCollectionActions(
    'postings',
    'p-',
    postingName,
  )
  // No prefix: the seeded pipelines are spelled 'cra', 'higheredjobs', 'stripe',
  // so one written this session has to be minted the same way.
  const [addPipelineRecord, updatePipeline, removePipeline] = useCollectionActions(
    'pipelines',
    '',
    pipelineName,
  )

  const addPosting = useCallback(
    (
      draft: Omit<SavedPosting, 'id' | 'savedOn' | 'linked'> & {
        savedOn?: string
        linked?: boolean
      },
    ) =>
      addPostingRecord({
        ...draft,
        savedOn: draft.savedOn ?? SAVED_NOW,
        linked: draft.linked ?? draft.applicationId !== undefined,
      }),
    [addPostingRecord],
  )

  /**
   * Turns a match into a real application and links the two.
   *
   * Linked, not moved: the match stays in the feed carrying its fit score, the
   * way `SavedPosting.linked` already models the same idea. Dropping the row
   * would make a mis-click unrecoverable — the feed is generated, and there is
   * nothing to press to get one suggestion back.
   */
  const promoteToApplication = useCallback(
    (matchId: string, roleTag?: RoleTag) => {
      const match = read().matches.find((m) => m.id === matchId)
      if (!match) return undefined

      // Matches read 'UNT — Assistant professor, machine learning'. Without the
      // dash the whole string is the employer, which is the safer half to keep.
      const [org, role = ''] = match.role.split(' — ')

      const application = addApplication({
        org,
        role,
        note: match.detail,
        roleTag: roleTag ?? guessRoleTag(match.role),
        stage: 'draft',
        source: 'Job scout',
        lastAction: 'Added from Job scout',
      })

      updateMatch(matchId, { applicationId: application.id })
      return application
    },
    [read, addApplication, updateMatch],
  )

  /**
   * The same move for a posting you saved yourself.
   *
   * Without it a saved posting was a dead end: the panel offered it as
   * "enough … to apply from" and then gave you nothing to apply with, while the
   * matches directly above carried "Add to applications". Linked rather than
   * consumed, exactly as a promoted match is, so the row stays where you filed
   * it and says where it went.
   *
   * The employer is read out of the URL and not out of the title. A title is
   * either a guess `draftFromUrl` already made from that same URL, or — for the
   * seeded rows — prose written the other way round ('Assistant Professor of
   * Computer Science — Rice University'), which would file the application
   * under a job title. The title only gets a turn when the URL names nobody.
   */
  const promotePosting = useCallback(
    (postingId: string, roleTag?: RoleTag) => {
      const posting = read().postings.find((p) => p.id === postingId)
      if (!posting) return undefined

      const guess = draftFromUrl(posting.url)
      const named = guess.org ? guess : { ...guess, ...draftFromText(posting.title) }

      const application = addApplication({
        org: named.org || posting.title,
        role: named.role ?? '',
        // Blank rather than a sentence about where this came from: `lastAction`
        // already says that, and the note field belongs to the user.
        note: '',
        roleTag: roleTag ?? guessRoleTag(`${posting.title} ${named.role ?? ''}`),
        stage: 'draft',
        // Where the ad lives, the same reading the paste field on /applications
        // takes. 'Job scout' is reserved for what a pipeline found by itself.
        source: named.source,
        url: named.url ?? posting.url,
        lastAction: 'Added from a saved posting',
      })

      updatePosting(postingId, { applicationId: application.id, linked: true })
      return application
    },
    [read, addApplication, updatePosting],
  )

  return useMemo(
    () => ({
      matches: state.matches,
      addMatch,
      updateMatch,
      removeMatch,
      postings: state.postings,
      addPosting,
      updatePosting,
      removePosting,
      pipelines: state.pipelines,
      addPipeline: addPipelineRecord,
      updatePipeline,
      removePipeline,
      promoteToApplication,
      promotePosting,
    }),
    [
      state.matches,
      addMatch,
      updateMatch,
      removeMatch,
      state.postings,
      addPosting,
      updatePosting,
      removePosting,
      state.pipelines,
      addPipelineRecord,
      updatePipeline,
      removePipeline,
      promoteToApplication,
      promotePosting,
    ],
  )
}

/* --------------------------------- profile -------------------------------- */

/**
 * The profile record, and the one write it takes.
 *
 * Here rather than in the route because the page was losing everything typed
 * into it on the first navigation while its own save bar said the opposite.
 * Nothing else reads it yet — the scout's matching and the assistant's drafting
 * both wait on a local model — but the Transfer manifest counts it and Settings
 * clears it, and both of those need it to be a record rather than route state.
 */
export function useProfile() {
  const { state, dispatch } = useStore()

  const update = useCallback(
    (patch: Partial<Profile>) => dispatch({ type: 'profile/update', patch }),
    [dispatch],
  )

  const profile = state.profile
  const isBlank = useMemo(() => profileIsBlank(profile), [profile])

  return useMemo(() => ({ profile, update, isBlank }), [profile, update, isBlank])
}

/* ---------------------------------- admin --------------------------------- */

export function useStoreAdmin() {
  const { state, dispatch } = useStore()
  const { clearRecords, resetRecords } = useLabels()

  /**
   * Both writes carry the keyword map with them, exactly as `remove` carries it
   * for one record.
   *
   * The reducer cannot: keywords live in a provider above this one and are not
   * in `StoreState`. Left behind, the edges outlive the records they point at —
   * a cleared store still reported "Used on 32 records" in Settings and ticked
   * the Guide's "tag something with a keyword" step on a first-run app, while
   * the Applications filter, which counts within a live list, read 0 for the
   * same keyword on the same screenful.
   */
  const reset = useCallback(() => {
    dispatch({ type: 'store/reset' })
    resetRecords()
  }, [dispatch, resetRecords])

  const clearAll = useCallback(() => {
    dispatch({ type: 'store/clear' })
    clearRecords()
  }, [dispatch, clearRecords])

  // The store only — labels live in their own provider and are not part of this
  // snapshot, so an export is not yet a full backup. Say so wherever it is offered.
  const exportJSON = useCallback(() => JSON.stringify(state, null, 2), [state])

  // Walked by key rather than over `Object.values(state)`: the profile is not a
  // list, and `undefined === 0` would have quietly made this always false.
  const isEmpty = useMemo(
    () => LIST_KEYS.every((key) => state[key].length === 0) && profileIsBlank(state.profile),
    [state],
  )

  return useMemo(
    () => ({ reset, clearAll, exportJSON, isEmpty }),
    [reset, clearAll, exportJSON, isEmpty],
  )
}
