import { useCallback } from 'react'
import type { PostingDraft } from '@jojo/service/agent/read-posting'
import type { Application, NodeId } from '@jojo/service/core/model'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'
import { useKg } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useVault } from '@jojo/service/react/use-vault'
import type { ModelSettings } from '@/lib/llm'
import { useReadPosting } from '@/lib/posting-agent'
import type { PostingRoute, PostingStep } from '@/lib/posting-agent'

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

export type FillPatch = {
  /** `application.update` input, less the id. Empty when there is nothing to write. */
  patch: Partial<Record<Fillable, string>> & { deadline?: string; keywords?: string[] }
  /** The fields written, in the person's words: "employer", "location". */
  filled: string[]
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
  for (const field of FILLABLE) {
    const value = draft[field]?.trim()
    if (!value) continue
    if ((now[field] ?? '') !== (before[field] ?? '')) continue
    if (value === (now[field] ?? '')) continue
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
  return { patch, filled }
}

export type FillOutcome =
  | {
      ok: true
      application: string
      /** The draft's name as it reads after the fill: "Kansas State University — Assistant Professor". */
      name: string
      filled: readonly string[]
      /** Fields the page did not answer. */
      missing: readonly string[]
      via: PostingRoute
    }
  | { ok: false; step: PostingStep | 'filling'; reason: string }

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
}) => Promise<FillOutcome> {
  const readPosting = useReadPosting()
  const run = useRun()
  const { repo, projections } = useKg()
  const { files, updateFile } = useVault()

  return useCallback(
    async ({ applicationId, url, settings, reader }) => {
      const id = applicationId as NodeId
      const before = projections.application(repo.getSnapshot(), id)
      if (!before)
        return {
          ok: false,
          step: 'filling',
          reason: 'The draft was deleted before its posting could be read.',
        }

      const kept = postingSourceForUrl(repo.getSnapshot(), url)
      const reuse = kept ? files.find((f) => f.id === kept.fileId) : undefined
      const read = await readPosting({
        url,
        settings,
        reader,
        ...(reuse ? { reuseFile: reuse } : {}),
      })
      if (!read.ok) return read

      const graph = repo.getSnapshot()
      const now = projections.application(graph, id)
      if (!now)
        return {
          ok: false,
          step: 'filling',
          reason: 'The draft was deleted while its posting was being read.',
        }

      const hasDeadline = projections
        .timeline(graph)
        .some((item) => item.kind === 'deadline' && item.applicationIds.includes(id))
      const nowKeywords = graph.many(id, 'TAGS', 'in', 'keyword').map((k) => k.id)
      const { patch, filled } = fillPatch(
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

      // The page, filed under the draft, beside anything it is filed under already.
      const filedUnder = graph
        .many(read.file.id as NodeId, 'FILED_UNDER', 'out', 'application')
        .map((a) => a.id)
      if (!filedUnder.includes(id))
        updateFile(read.file.id, { applicationIds: [...filedUnder, id] })

      const after = projections.application(repo.getSnapshot(), id) ?? now
      const name = after.role ? `${after.org} — ${after.role}` : after.org
      return { ok: true, application: id, name, filled, missing: read.missing, via: read.via }
    },
    [readPosting, run, repo, projections, files, updateFile],
  )
}
