/**
 * L1 — the rules for a referee brief, in one place. See `RefereeBrief`.
 *
 * Shared by `vault.person.update`, which stores briefs, and the export dialog,
 * which edits and exports them, so the two cannot disagree about what a
 * highlight is or when a brief counts as empty. Pure: every function returns
 * new arrays, because the journal stages whole-record images and an array
 * shared with a previous image would be edited underneath it.
 */
import {
  MAX_BRIEF_HIGHLIGHTS,
  MAX_BRIEF_HIGHLIGHT_TEXT,
  MAX_BRIEF_NOTE_TEXT,
  MAX_BRIEFS,
  type RefereeBrief,
} from './model'

/** Whitespace runs to one space, ends trimmed. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Highlights as a person types them: `teaching, NSF CAREER; causal inference`.
 *
 * Commas, semicolons and line breaks all separate, because those are the three
 * ways a list gets typed or pasted. Repeats are dropped ignoring case — listing
 * "Teaching" twice tells a recommender nothing twice — and the first spelling
 * wins. Over-long items are cut rather than refused: a highlight is a phrase,
 * and an editor that rejected a whole save over one long phrase would lose the
 * other eleven.
 */
export function parseHighlights(input: string | readonly string[]): string[] {
  const parts = typeof input === 'string' ? input.split(/[,;\n\r]+/) : input.flatMap((item) => item.split(/[,;\n\r]+/))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts) {
    const item = tidy(raw).slice(0, MAX_BRIEF_HIGHLIGHT_TEXT).trim()
    if (item === '' || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    out.push(item)
    if (out.length === MAX_BRIEF_HIGHLIGHTS) break
  }
  return out
}

/** Highlights back to the text an editor shows. The inverse of `parseHighlights`. */
export const highlightsText = (highlights: readonly string[] | undefined) =>
  (highlights ?? []).join(', ')

/**
 * A brief with its fields cleaned, or `null` when nothing is left in it.
 *
 * An empty brief is not stored: "no highlights and no note" is exactly what an
 * application with no brief already means, and keeping both spellings would
 * make "has this referee been briefed" a question with two answers.
 */
export function normaliseBrief(brief: RefereeBrief): RefereeBrief | null {
  const highlights = parseHighlights(brief.highlights ?? [])
  const note = (brief.note ?? '').trim().slice(0, MAX_BRIEF_NOTE_TEXT)
  if (highlights.length === 0 && note === '') return null
  return {
    applicationId: brief.applicationId,
    ...(highlights.length === 0 ? {} : { highlights }),
    ...(note === '' ? {} : { note }),
  }
}

/**
 * The briefs to store: cleaned, one per application, and only for applications
 * the person is filed under. A later brief for the same application replaces an
 * earlier one, so a list built by appending edits keeps the latest.
 */
export function normaliseBriefs(
  briefs: readonly RefereeBrief[],
  filed: ReadonlySet<string>,
): RefereeBrief[] {
  const byApplication = new Map<string, RefereeBrief>()
  for (const brief of briefs) {
    if (!filed.has(brief.applicationId)) continue
    const clean = normaliseBrief(brief)
    // Deleted first so a replacement moves to where it was written last.
    byApplication.delete(brief.applicationId)
    if (clean !== null) byApplication.set(brief.applicationId, clean)
  }
  return [...byApplication.values()].slice(0, MAX_BRIEFS)
}

/** The briefs still about an application in `filed`, as fresh copies. */
export function briefsWithin(
  briefs: readonly RefereeBrief[] | undefined,
  filed: ReadonlySet<string>,
): RefereeBrief[] {
  return (briefs ?? [])
    .filter((brief) => filed.has(brief.applicationId))
    .map((brief) => ({
      ...brief,
      ...(brief.highlights === undefined ? {} : { highlights: [...brief.highlights] }),
    }))
}

/** The brief for one application, if there is one. */
export const briefFor = (briefs: readonly RefereeBrief[] | undefined, applicationId: string) =>
  (briefs ?? []).find((brief) => brief.applicationId === applicationId)
