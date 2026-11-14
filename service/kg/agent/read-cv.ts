/**
 * Turning a CV into facts the graph can hold. L3.
 *
 * The sibling of `read-posting.ts`, pointed the other way. That one reads the
 * employer's side of a match and produces an application draft; this one reads
 * the person's side and produces the things a hiring committee would actually
 * weigh — where they studied, what they have held, what they have published,
 * what they can teach.
 *
 * ## Why this exists
 *
 * A CV could be uploaded and read — `vault.file.read` has converted documents
 * to text for a while — and nothing ever looked at what came back. The profile
 * was ten fields somebody typed, `fitOf` scored postings against those, and a
 * person who had uploaded forty pages of evidence got exactly the same answer
 * as a person who had uploaded nothing. The document was in the app and not in
 * the graph.
 *
 * ## Exhaustive about what is written, silent about what is not
 *
 * The first version of this file made omission easy and said nothing at all
 * about completeness. Every instruction was a permission to leave something
 * out, for a good reason — a model asked to extract from a CV will, unprompted,
 * fill in a plausible university, invent a date range from context, or promote
 * "familiar with Rust" into a skill entry that reads like expertise, and each
 * of those is a claim about a real person that they never made, sitting in
 * their own records, shown to them as though they wrote it.
 *
 * That reason still holds and none of those instructions have gone. What was
 * wrong was the missing half: a model told six times to omit and never once to
 * be complete returns a representative sample of a CV, not a reading of it.
 * The two goals are not in tension once they are stated separately —
 *
 *   - Every entry the document STATES must come back. Leaving one out is an
 *     error exactly as much as inventing one.
 *   - Nothing the document does not state may be added. Omit the key, omit the
 *     entry, say nothing rather than guess.
 *
 * ## Why it reads the document in sections, and twice
 *
 * A single pass over a whole CV is where the rest of the loss was. Asked for
 * one flat list of facts from 24k characters, models produce ten to fifteen
 * entries and stop — long-list generation degrades, and the tail of a CV is
 * where the publications are. Splitting on the document's own headings and
 * asking each section for everything in it turns one impossible instruction
 * into six easy ones, and it is the single largest recall win available here.
 *
 * Then `missedMessages` asks once more, showing the model what was found and
 * asking only what was left out. That pass raises recall at some cost to
 * precision, which is the right trade for this direction: a wrong entry is
 * visible in the review list and one click to drop, and a missing one is
 * invisible forever.
 *
 * ## Why the reply is JSON and parsed defensively
 *
 * Same reason as the posting reader: a small local model writes prose around
 * its JSON, fences it, or trails a comma. The parser strips a fence, finds the
 * outermost object, and refuses cleanly rather than throwing — because the
 * caller's next move is to tell the user their CV could not be read, not to
 * crash the screen they uploaded it from.
 *
 * ## Where each part lives
 *
 * This file is the surface every caller imports from, and it holds nothing but
 * the names. The work is split by what it does:
 *
 *   - `read-cv-sections.ts`  — the document cut on its headings into passes.
 *   - `read-cv-prompt.ts`    — the extraction rules and the pass messages.
 *   - `read-cv-parse.ts`     — the reply turned into drafts, row by row.
 *   - `read-cv-merge.ts`     — the passes merged, each entry once.
 *   - `read-cv-relations.ts` — how the settled entries relate.
 */

export { CV_BUDGET, cvSections, cvPasses } from './read-cv-sections'
export type { CvSection, CvPass } from './read-cv-sections'
export { cvMessages, MISSED_BUDGET, missedMessages } from './read-cv-prompt'
export { readCv } from './read-cv-parse'
export type { BackgroundDraft, CvRead } from './read-cv-parse'
export { mergeBackground } from './read-cv-merge'
export { RELATIONS_BUDGET, relationMessages, readRelations } from './read-cv-relations'
export type { RelationDraft } from './read-cv-relations'
