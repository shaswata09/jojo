import { useCallback } from 'react'
import type { PostingDraft } from '@jojo/service/agent/read-posting'
import type { Application, NodeId } from '@jojo/service/core/model'
import { SOURCES } from '@jojo/service/core/model'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'
import { postingIdentity } from '@jojo/service/core/capture'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { DEFAULT_THINKING, helperThinking } from '@jojo/service/core/model-server'
import { useDuplicateCheck } from '@/lib/duplicate-agent'
import { useUndoable } from '@/lib/undo'
import { useKg } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useVault } from '@jojo/service/react/use-vault'
import type { ModelSettings } from '@/lib/llm'
import { useReadPosting } from '@/lib/posting-agent'
import type { PostingOutcome, PostingRoute, PostingStep } from '@/lib/posting-agent'

/** The fields a posting can fill on an application, in the order they are reported. */
const FILLABLE = ['org', 'role', 'roleTag', 'location', 'comp', 'postingId', 'source'] as const
type Fillable = (typeof FILLABLE)[number]

/** What each field is called in the sentence that reports the fill. */
const SPOKEN: Record<Fillable | 'deadline' | 'keywords', string> = {
  org: 'employer',
  role: 'role',
  roleTag: 'role type',
  location: 'location',
  comp: 'pay',
  postingId: 'posting ID',
  source: 'source',
  deadline: 'deadline',
  keywords: 'keywords',
}

/**
 * A board's capitals, put back into ordinary case: "KANSAS STATE UNIVERSITY"
 * → "Kansas State University", "MANHATTAN, Kansas" → "Manhattan, Kansas".
 *
 * Boards set the employer and city in capitals for display, and a model copies
 * what it reads — measured on CRA's board, where Gemma 4 returned the
 * capitals on one read and ordinary case on the next. Only words of five
 * letters or more are touched, so the acronyms an employer or place is
 * actually spelled with (MIT, UCLA, NYU, KS, USA) stay as they are.
 */
export function unshout(text: string): string {
  return text.replace(
    /\b[A-Z][A-Z'’-]{4,}\b/g,
    (word) => word.charAt(0) + word.slice(1).toLowerCase(),
  )
}

/** The fields whose capitals are the board's styling rather than their spelling. */
const UNSHOUT: ReadonlySet<Fillable> = new Set(['org', 'location'])

export type FillPatch = {
  /** `application.update` input, less the id. Empty when there is nothing to write. */
  patch: Partial<Record<Fillable, string>> & { deadline?: string; keywords?: string[] }
  /** The fields written, in the person's words: "employer", "location". */
  filled: string[]
  /** Fields the draft already had, that the page agrees with. */
  confirmed: string[]
  /** Fields the person changed while the page was read, where the page says otherwise. Left as they are. */
  keptYours: string[]
}

/**
 * What reading a posting should change on the draft it became.
 *
 * Every field the page answered, EXCEPT one the person has changed since the
 * draft was made. The read takes several seconds — a page to open and a model
 * to ask — and the draft is on screen the whole time; a person who corrected
 * the role in the meantime meant it, and a fill that landed on top of their
 * edit would undo it without asking. `before` is the draft as it was made,
 * `now` is the draft as it is when the answer arrives, and only the fields
 * still matching are fair game.
 *
 * A value the same as what is there already is not a fill, and is not
 * reported as one.
 */
export function fillPatch(
  before: Pick<Application, Fillable>,
  now: Pick<Application, Fillable> & { keywords?: readonly string[] },
  draft: PostingDraft,
  keywords: readonly string[],
  hasDeadline: boolean,
): FillPatch {
  const patch: FillPatch['patch'] = {}
  const filled: string[] = []
  const confirmed: string[] = []
  const keptYours: string[] = []
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  for (const field of FILLABLE) {
    const raw = draft[field]?.trim()
    if (!raw) continue
    const value = UNSHOUT.has(field) ? unshout(raw) : raw
    const current = now[field] ?? ''
    if (same(value, current)) {
      confirmed.push(SPOKEN[field])
      continue
    }
    if (current !== (before[field] ?? '')) {
      keptYours.push(SPOKEN[field])
      continue
    }
    patch[field] = value
    filled.push(SPOKEN[field])
  }
  // A deadline only where the draft has none: one somebody added by hand wins.
  if (draft.deadline && !hasDeadline) {
    patch.deadline = draft.deadline
    filled.push(SPOKEN.deadline)
  }
  // Keywords only onto a draft that has none, for the same reason.
  if (keywords.length > 0 && (now.keywords ?? []).length === 0) {
    patch.keywords = [...keywords]
    filled.push(SPOKEN.keywords)
  }
  return { patch, filled, confirmed, keptYours }
}

/** A stored reading's fields as a draft — the source only when it is one the app knows. */
function knownDraft(known: Extract<ScoutReading, { ok: true }>, url: string): PostingDraft {
  const { source, ...rest } = known.fields
  const valid = (SOURCES as readonly string[]).includes(source ?? '')
  return { ...rest, ...(valid ? { source: source as Application['source'] } : {}), url }
}

/** Why the static rule called it a duplicate, in a sentence. */
const DUPLICATE_WHY = {
  id: 'Both postings carry the same posting ID.',
  url: 'Both are the same posting address.',
  name: 'Same employer and role.',
} as const

export type FillOutcome =
  | {
      ok: true
      application: string
      /** The draft's name as it reads after the fill: "Kansas State University — Assistant Professor". */
      name: string
      filled: readonly string[]
      confirmed: readonly string[]
      keptYours: readonly string[]
      /** Fields the page did not answer. */
      missing: readonly string[]
      via: PostingRoute
      /**
       * Set when the page turned out to be a job already in the applications —
       * the same posting reposted on another board. The draft has been removed
       * and the posting and its page are filed under the one that was there.
       * `restore` puts the draft back ("Keep both").
       */
      duplicate?: { id: string; name: string; why: string; restore: () => void }
    }
  | {
      ok: false
      step: PostingStep | 'filling'
      reason: string
      /** The page was kept and filed under the draft, though its fields were not filled. */
      kept?: true
    }

/**
 * Reads a posting and fills the application it became — "From link"'s
 * pre-fill, for a draft that already exists.
 *
 * The scout approves a job and makes its draft at once, from what the address
 * alone says ("CRA — Assistant professor"); this then opens the page, asks the
 * model the same questions the From-link form asks, keeps the page in the
 * Vault, files it under the draft, and writes back what the page said
 * ("Kansas State University", "Assistant Professor", Manhattan, KS, the
 * deadline).
 */
export function useFillFromPosting(): (options: {
  applicationId: string
  url: string
  settings: ModelSettings
  reader: string
  /**
   * What the page said when it was read while the suggestion waited — see
   * `ScoutReader`. Used instead of opening the page again, as long as the
   * page it kept is still in the Vault.
   */
  known?: Extract<ScoutReading, { ok: true }>
}) => Promise<FillOutcome> {
  const readPosting = useReadPosting()
  const run = useRun()
  const { repo, projections } = useKg()
  const { files, updateFile } = useVault()
  const checkDuplicate = useDuplicateCheck()
  const undoable = useUndoable()

  return useCallback(
    async ({ applicationId, url, settings, reader, known }) => {
      const id = applicationId as NodeId
      /** Files a kept page under the draft, beside anything it is filed under already. */
      const fileUnder = (fileId: string, application: NodeId) => {
        const filed = repo
          .getSnapshot()
          .many(fileId as NodeId, 'FILED_UNDER', 'out', 'application')
          .map((a) => a.id)
        if (!filed.includes(application))
          updateFile(fileId, { applicationIds: [...filed, application] })
      }
      const before = projections.application(repo.getSnapshot(), id)
      if (!before)
        return {
          ok: false,
          step: 'filling',
          reason: 'The draft was deleted before its posting could be read.',
        }

      const knownFile = known?.fileId ? files.find((f) => f.id === known.fileId) : undefined
      const read: PostingOutcome =
        known && knownFile
          ? {
              ok: true,
              draft: knownDraft(known, url),
              file: knownFile,
              missing: known.missing,
              keywords: known.keywords.map((k) => k.id),
              via: known.via,
            }
          : await (() => {
              const kept = postingSourceForUrl(repo.getSnapshot(), url)
              const reuse = kept ? files.find((f) => f.id === kept.fileId) : undefined
              return readPosting({
                url,
                settings,
                reader,
                ...(reuse ? { reuseFile: reuse } : {}),
              })
            })()
      if (!read.ok) {
        /*
         * The page was kept before the model was asked (`useReadPosting`), so a
         * refused or unparseable answer still leaves it in the Vault — filed
         * under the draft here, so the application opens with its posting
         * attached even though the fields stayed as the address guessed them.
         */
        if (read.file) fileUnder(read.file.id, id)
        return {
          ok: false,
          step: read.step,
          reason: read.reason,
          ...(read.file ? { kept: true as const } : {}),
        }
      }

      const graph = repo.getSnapshot()
      const now = projections.application(graph, id)
      if (!now)
        return {
          ok: false,
          step: 'filling',
          reason: 'The draft was deleted while its posting was being read.',
        }

      /*
       * The same job, already an application — checked on what the PAGE says,
       * which is the strongest evidence there is: its posting ID, its address,
       * its employer and role, then the model as judge (`use-duplicate-check`,
       * the same check the New application form runs). The scout's own check
       * runs on a listing's few words and lets through what only the page can
       * settle, like a CRA listing titled "Assistant Professor" for the
       * HigherEdJobs one titled "…--Computer Science".
       */
      const merged = {
        org: read.draft.org ?? now.org,
        role: read.draft.role ?? now.role,
        location: read.draft.location ?? now.location,
        url: now.url ?? url,
        postingId: read.draft.postingId ?? now.postingId,
      }
      const found = await checkDuplicate({
        existing: projections.applications(graph),
        candidate: merged,
        skipId: id,
        settings: { ...settings, thinking: helperThinking(settings.thinking ?? DEFAULT_THINKING) },
      }).catch(() => null)
      if (found) {
        const existing = found.record
        const posting = projections
          .postings(graph)
          .find((p) => p.applicationId === id || postingIdentity(p.url) === postingIdentity(url))
        const pageFiled = graph
          .many(read.file.id as NodeId, 'FILED_UNDER', 'out', 'application')
          .map((a) => a.id)
          .filter((a) => a !== id)
        const { restore } = undoable(() => {
          run('application.delete', { id })
          if (posting)
            run('scout.posting.update', {
              id: posting.id as NodeId,
              applicationId: existing.id as NodeId,
            })
          updateFile(read.file.id, { applicationIds: [...new Set([...pageFiled, existing.id])] })
        })
        const existingName = existing.role ? `${existing.org} — ${existing.role}` : existing.org
        return {
          ok: true,
          application: existing.id,
          name: existingName,
          filled: [],
          confirmed: [],
          keptYours: [],
          missing: read.missing,
          via: read.via,
          duplicate: {
            id: existing.id,
            name: existingName,
            why: found.because ?? DUPLICATE_WHY[found.reason],
            restore: restore ?? (() => {}),
          },
        }
      }

      const hasDeadline = projections
        .timeline(graph)
        .some((item) => item.kind === 'deadline' && item.applicationIds.includes(id))
      const nowKeywords = graph.many(id, 'TAGS', 'in', 'keyword').map((k) => k.id)
      const { patch, filled, confirmed, keptYours } = fillPatch(
        before,
        { ...now, keywords: nowKeywords },
        read.draft,
        read.keywords,
        hasDeadline,
      )

      if (Object.keys(patch).length > 0) {
        const written = run('application.update', { id, ...patch } as never)
        if (!written.ok) {
          return {
            ok: false,
            step: 'filling',
            reason: written.errors[0]?.message ?? 'The draft could not be updated.',
          }
        }
      }

      fileUnder(read.file.id, id)

      const after = projections.application(repo.getSnapshot(), id) ?? now
      const name = after.role ? `${after.org} — ${after.role}` : after.org
      return {
        ok: true,
        application: id,
        name,
        filled,
        confirmed,
        keptYours,
        missing: read.missing,
        via: read.via,
      }
    },
    [readPosting, run, repo, projections, files, updateFile, checkDuplicate, undoable],
  )
}
