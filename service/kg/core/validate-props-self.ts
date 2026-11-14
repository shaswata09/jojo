/**
 * Prop schemas for what the app knows about the person and says with them:
 * claims, background facts, conversations and the profile. Assembled into
 * `NODE_PROP_SCHEMAS` in `validate-props.ts`.
 */

import type { ThreadEntry } from './model'
import { APPROVAL_MODES, BACKGROUND_KINDS } from './model'
import type { Schema } from './schema'
import { s } from './schema'
import { slug } from './validate-props-slug'

/**
 * An array of turns, checked as an array and not as turns.
 *
 * The cast is the honest expression of the loose check above it: what comes back
 * is `unknown[]`, and calling it `ThreadEntry[]` here is the same trust boundary
 * `validate-records.ts` already crosses for `props` itself. It is
 * declared once, next to its reason, rather than inlined where it would read as
 * an oversight.
 */
const threadEntries = s.array(s.unknown(), { label: 'Messages' }) as unknown as Schema<
  ThreadEntry[]
>

const profileTextSchema = s.object({
  fullName: s.string({ label: 'Full name' }),
  position: s.string({ label: 'Position' }),
  location: s.string({ label: 'Location' }),
  email: s.string({ label: 'Email' }),
  website: s.string({ label: 'Website' }),
  scholar: s.string({ label: 'Scholar' }),
  github: s.string({ label: 'GitHub' }),
  linkedin: s.string({ label: 'LinkedIn' }),
  targetRoles: s.string({ label: 'Target roles' }),
  regions: s.string({ label: 'Regions' }),
})

/**
 * A relation, with its predicate as a string rather than an enum.
 *
 * Deliberately not `s.enum(...)` over the taxonomy. The whole point of the
 * open lane is that a predicate nobody enumerated is still stored, and a
 * validator that rejected one would delete exactly the facts a curated list
 * was never going to anticipate — on load, silently, from a backup.
 */
export const claimProps = s.object({
  slug,
  predicate: s.string({ min: 1, label: 'Relation' }),
  surface: s.string({ min: 1, label: 'As written' }),
  known: s.boolean({ label: 'In the taxonomy' }),
  source: s.optional(s.string({ label: 'Read from' })),
})

/**
 * One fact about the user, read out of something they wrote.
 *
 * `period` is a STRING and deliberately not a date. A CV says "2021–2024",
 * "Summer 2019", "since 2024" and "n.d."; forcing those into ISO means either
 * refusing most of them or inventing precision nobody wrote down. `year` is
 * the sortable half, and it is optional because plenty of entries have none
 * that can be recovered.
 *
 * `source` is not checked as a node id here. Validation runs on load, when a
 * restored backup may hold a background whose source file was deleted before
 * the export — and a fact somebody's CV states does not stop being true
 * because the PDF is gone. It is a provenance breadcrumb, not a foreign key,
 * and the readers treat it as one.
 */
export const backgroundProps = s.object({
  slug,
  kind: s.enum(BACKGROUND_KINDS, { label: 'Kind' }),
  title: s.string({ min: 1, label: 'Title' }),
  where: s.optional(s.string({ label: 'Where' })),
  period: s.optional(s.string({ label: 'When' })),
  year: s.optional(s.number({ min: 1900, max: 2100, label: 'Year' })),
  detail: s.optional(s.string({ label: 'Detail', multiline: true })),
  highlights: s.optional(s.array(s.string({ min: 1 }), { label: 'Highlights' })),
  source: s.optional(s.string({ label: 'Read from' })),
})

/**
 * A conversation, validated loosely on purpose.
 *
 * `entries` is `s.unknown()` and every other schema here is exact, so the
 * exception has to earn itself. Two reasons, and the second is the one that
 * decides it:
 *
 *   1. It is a UNION of five shapes, and `core/schema.ts` has no union
 *      combinator — deliberately, because `FieldMeta` has to stay drawable as
 *      a form and a union of five is not a field.
 *   2. A transcript is append-only history. Every other prop here describes
 *      something the user can retype if a build rejects it; a chat log is not
 *      retypable, and a stricter schema would mean a thread written by a newer
 *      build is DROPPED by an older one. `validateRows` deletes what it cannot
 *      parse, so strictness here is measured in lost conversations.
 *
 * What still holds the line is the reader: `ThreadEntry` is a discriminated
 * union in TypeScript, and `entriesOf` in `kg/react/use-threads.ts` filters
 * anything that does not match before a screen ever sees it. Junk in this
 * array renders as nothing rather than as a crash.
 */
export const threadProps = s.object({
  slug,
  title: s.string({ min: 1, label: 'Title' }),
  entries: threadEntries,
  // Kept so a conversation written before modes still validates. Nothing
  // writes it any more; `approvalOf` reads it as a fallback.
  autoApprove: s.optional(s.boolean({ label: 'Act without asking' })),
  approval: s.optional(s.enum(APPROVAL_MODES, { label: 'Approval' })),
  // The compaction summary and how far it reaches — see `ThreadProps`. Both
  // optional, because almost no conversation ever grows enough to need one.
  context: s.optional(s.string({ label: 'Earlier in this conversation' })),
  contextThrough: s.optional(s.number({ min: 0, int: true, label: 'Summarised through' })),
})

export const profileProps = s.object({
  text: profileTextSchema,
  matchTerms: s.array(s.string({ min: 1 }), { label: 'Match terms' }),
  roles: s.array(s.string({ min: 1 }), { label: 'Role tags' }),
  includeAcademia: s.boolean({ label: 'Include academia' }),
  includeIndustry: s.boolean({ label: 'Include industry' }),
})
