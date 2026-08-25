import { BACKGROUND_KINDS, DEFAULT_ROLES } from '../core/model'
/**
 * L3 — the profile tools.
 *
 * One node, not a collection. It is in the graph rather than in route state
 * because of the bug the audit found: the profile page held it locally, so the
 * name you saved was gone the moment you clicked anything in the sidebar, while
 * its own save bar promised it was "kept for this visit".
 *
 * `profile.document.add` is a thin composite over `vault.file.add`. A document
 * on the profile page and a file in the Vault were never two things — the page
 * filters one collection to the bucket that means "what I send with an
 * application" — and giving it its own storage is how the count on one screen
 * starts disagreeing with the list on the other.
 */

import type { FileBucket, NodeId, ProfileText } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { s } from '../core/schema'
import { cleared } from './application-fields'
import { opt } from './support'
import { defineTool } from './tool'
import type { ToolContext } from './tool'

const TEXT_FIELDS = [
  'fullName',
  'position',
  'location',
  'email',
  'website',
  'scholar',
  'github',
  'linkedin',
  'targetRoles',
  'regions',
] as const satisfies readonly (keyof ProfileText)[]

const PREFERENCES = ['includeAcademia', 'includeIndustry'] as const

/** What the profile page means by "documents". */
const DOCUMENTS_BUCKET: FileBucket = 'Applications'

const BLANK_TEXT: ProfileText = {
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
}

/**
 * The profile node, minted on first write.
 *
 * There is always conceptually a profile, and a tool that failed with "no
 * profile record" the first time someone typed their name would be reporting an
 * implementation detail as a user error. Created empty rather than seeded:
 * an app with no records must not still be carrying a stranger's name.
 */
export function profileNode(ctx: ToolContext) {
  const existing = ctx.memory.ofType('profile')[0]
  if (existing) return existing

  const id = ctx.newId('profile')
  return ctx.tx.put({
    id,
    type: 'profile',
    props: {
      text: { ...BLANK_TEXT },
      roles: [...DEFAULT_ROLES],
      matchTerms: [],
      // Both switches start on: an untouched profile filters nothing out, and a
      // scout that silently excluded half the boards would be a setting nobody
      // chose.
      includeAcademia: true,
      includeIndustry: true,
    },
    createdAt: ctx.now,
    updatedAt: ctx.now,
  })
}

/**
 * The whole record, saved at once.
 *
 * `profile.text.set` writes one field, which is right for a field that saves on
 * blur and wrong for the page as it stands: `routes/Profile.tsx` has a save bar over
 * ten inputs, and ten tools would be ten journal rows and ten Undos for one
 * press of Save. Absent from §4's catalogue for the same reason it is `internal`
 * here — it is the shape of today's form, not a verb anyone should reach for
 * from the palette.
 */
const textShape = s.object(
  Object.fromEntries(TEXT_FIELDS.map((f) => [f, s.string({ label: f })])) as {
    [K in (typeof TEXT_FIELDS)[number]]: ReturnType<typeof s.string>
  },
)

export const profileSet = defineTool({
  name: 'profile.set',
  title: 'Save profile',
  summary: 'Saves the profile page in one write.',
  effect: 'update',
  touches: ['profile'],
  internal: true,
  input: s.object({
    text: s.optional(textShape),
    matchTerms: s.optional(s.array(s.string({ min: 1 }), { label: 'Match terms' })),
    includeAcademia: s.optional(s.boolean({ label: 'Include academia' })),
    includeIndustry: s.optional(s.boolean({ label: 'Include industry' })),
  }),

  run(ctx, input) {
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, {
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.matchTerms === undefined ? {} : { matchTerms: input.matchTerms }),
      ...(input.includeAcademia === undefined ? {} : { includeAcademia: input.includeAcademia }),
      ...(input.includeIndustry === undefined ? {} : { includeIndustry: input.includeIndustry }),
    })
  },

  describe: () => ({ title: 'Profile saved', description: 'None of it leaves your device.' }),
})

export const profileTextSet = defineTool({
  name: 'profile.text.set',
  // 'Edit profile' promised the whole page and generates a two-control form
  // — pick a field, type a value. The palette builds its form from these two
  // strings, so a title wider than the input is a form that reads as broken.
  title: 'Edit one profile field',
  summary: 'Saves a single field — name, position, email, a link — on the profile.',
  effect: 'update',
  touches: ['profile'],
  input: s.object({
    field: s.enum(TEXT_FIELDS, { label: 'Field' }),
    value: s.string({ label: 'Value' }),
  }),

  run(ctx, input) {
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, {
      text: { ...profile.props.text, [input.field]: input.value.trim() },
    })
  },

  describe: () => ({
    title: 'Profile saved',
    description: 'None of it leaves your device.',
  }),
})

export const profileMatchTermAdd = defineTool({
  name: 'profile.matchTerm.add',
  title: 'Add match term',
  summary: 'Adds a term the scout scores postings against.',
  effect: 'update',
  touches: ['profile'],
  input: s.object({ term: s.string({ min: 1, max: 60, label: 'Term' }) }),

  run(ctx, input) {
    const profile = profileNode(ctx)
    const term = input.term.trim()
    // Not the global keyword system — the panel copy has to keep the two apart
    // for the reader, so the tools keep them apart too. A match term is a string
    // on the profile; a keyword is a node with edges.
    if (profile.props.matchTerms.includes(term)) return
    ctx.tx.patch<'profile'>(profile.id, { matchTerms: [...profile.props.matchTerms, term] })
  },

  describe: (input) => ({ title: `${input.term.trim()} added` }),
})

export const profileMatchTermRemove = defineTool({
  name: 'profile.matchTerm.remove',
  title: 'Remove match term',
  summary: 'Drops a term from what the scout matches on.',
  effect: 'update',
  touches: ['profile'],
  input: s.object({ term: s.string({ min: 1, label: 'Term' }) }),

  run(ctx, input) {
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, {
      matchTerms: profile.props.matchTerms.filter((t) => t !== input.term),
    })
  },

  describe: (input) => ({ title: `${input.term} removed` }),
})

export const profilePreferenceSet = defineTool({
  name: 'profile.preference.set',
  title: 'Change scout preference',
  summary: 'Switches academia or industry postings in or out of the scout.',
  effect: 'update',
  touches: ['profile'],
  input: s.object({
    key: s.enum(PREFERENCES, { label: 'Preference' }),
    value: s.boolean({ label: 'Include' }),
  }),

  run(ctx, input) {
    const profile = profileNode(ctx)
    ctx.tx.patch<'profile'>(profile.id, { [input.key]: input.value })
  },

  describe: (input) => ({
    title: input.value ? 'Included' : 'Excluded',
    description: input.key === 'includeAcademia' ? 'Academia postings' : 'Industry postings',
  }),
})

export const profileDocumentAdd = defineTool({
  name: 'profile.document.add',
  title: 'Add document',
  summary: 'Files a document in the Vault under the bucket the profile page reads.',
  effect: 'create',
  touches: ['file'],
  input: s.object({
    files: s.array(
      s.object({
        name: s.string({ min: 1, label: 'Name' }),
        kind: s.enum(['pdf', 'doc', 'slides', 'note'] as const, { label: 'Kind' }),
        size: s.string({ label: 'Size' }),
      }),
      { min: 1, label: 'Documents' },
    ),
  }),

  run(ctx, input): NodeId[] {
    return ctx.call('vault.file.add', {
      files: input.files.map((f) => ({ ...f, bucket: DOCUMENTS_BUCKET })),
    })
  },

  describe: (_input, ids) => ({
    title: ids.length === 1 ? 'Document added' : `${ids.length} documents added`,
    description: `Filed in the Vault under ${DOCUMENTS_BUCKET}. The name, size and type are kept — the file itself is not read.`,
  }),
})

/* -------------------------------------------------------------------------- */
/* What the user has actually done                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shape of one extracted fact, shared by add and update.
 *
 * `source` is a plain string rather than `s.id('file')` deliberately. The
 * extractor knows which document it read, but a person typing a background by
 * hand has no document — and a required id would force the commonest manual
 * case to invent one. The readers treat it as a breadcrumb, not a foreign key.
 */
const backgroundFields = {
  kind: s.enum(BACKGROUND_KINDS, { label: 'Kind' }),
  title: s.string({ min: 1, label: 'Title' }),
  where: s.optional(s.string({ label: 'Where' })),
  period: s.optional(s.string({ label: 'When', description: 'As written: “2021–2024”, “since 2024”.' })),
  year: s.optional(s.number({ min: 1900, max: 2100, label: 'Year' })),
  detail: s.optional(s.string({ label: 'Detail', multiline: true })),
  highlights: s.optional(
    s.array(s.string({ min: 1 }), {
      label: 'Highlights',
      description: 'The bullet points under this entry — what was built, shipped, taught or found.',
    }),
  ),
  source: s.optional(s.string({ label: 'Read from', description: 'The id of the document this came from.' })),
}

export const profileBackgroundAdd = defineTool({
  name: 'profile.background.add',
  title: 'Record background',
  summary:
    'Files facts about the person — a degree, a post held, a paper, a skill, teaching. Use after reading a CV or when they tell you something about their background.',
  effect: 'create',
  touches: ['background'],
  /**
   * Bulk, like `vault.file.add`, and for the same reason turned up an order of
   * magnitude here.
   *
   * A CV yields thirty facts. One tool call each is thirty round trips, thirty
   * approval prompts and thirty journal rows for what a person did once — and
   * with `maxSteps` at eight the agent runs out of rounds before it reaches the
   * publications. The array is what makes importing a CV a single action.
   */
  input: s.object({
    background: s.array(s.object(backgroundFields), { min: 1, label: 'Background' }),
  }),

  run(ctx, input): NodeId[] {
    return input.background.map((draft) => {
      const id = ctx.newId('background')
      ctx.tx.put({
        id,
        type: 'background',
        props: {
          slug: ctx.mintSlug('background', draft.title),
          kind: draft.kind,
          title: draft.title.trim(),
          ...opt('where', cleared(draft.where)),
          ...opt('period', cleared(draft.period)),
          ...(draft.year === undefined ? {} : { year: draft.year }),
          ...opt('detail', cleared(draft.detail)),
          /*
           * Dropped when empty rather than stored as `[]`. An entry with no
           * bullets and an entry with an empty list of them are the same fact,
           * and only one of the two shapes should ever reach a reader.
           */
          ...(draft.highlights && draft.highlights.length > 0
            ? { highlights: draft.highlights }
            : {}),
          ...opt('source', cleared(draft.source)),
        },
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      return id
    })
  },

  describe: (input, ids) => ({
    title: ids.length === 1 ? 'Background recorded' : `${ids.length} facts recorded`,
    description: input.background
      .map((c) => c.title)
      .slice(0, 3)
      .join(', '),
  }),
})

export const profileBackgroundUpdate = defineTool({
  name: 'profile.background.update',
  title: 'Edit background',
  summary: 'Corrects one recorded fact about the person.',
  effect: 'update',
  touches: ['background'],
  /*
   * Written out rather than derived from `backgroundFields` with a mapped type.
   * The derivation was two lines shorter and would not typecheck — `year` is a
   * number and the others are strings, so `Object.entries` widens the union and
   * `s.optional` can no longer be applied to it. Explicit is what the schema
   * builder is for.
   */
  input: s.object({
    id: s.id('background', { label: 'Entry' }),
    kind: s.optional(s.enum(BACKGROUND_KINDS, { label: 'Kind' })),
    title: s.optional(s.string({ min: 1, label: 'Title' })),
    where: s.optional(s.string({ label: 'Where' })),
    period: s.optional(s.string({ label: 'When' })),
    year: s.optional(s.number({ min: 1900, max: 2100, label: 'Year' })),
    detail: s.optional(s.string({ label: 'Detail', multiline: true })),
    highlights: s.optional(
      s.array(s.string({ min: 1 }), {
        label: 'Highlights',
        description: 'Replaces the bullet points under this entry, all of them.',
      }),
    ),
  }),

  run(ctx, input) {
    ctx.require('background', input.id)
    ctx.tx.patch<'background'>(input.id, {
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...opt('title', input.title?.trim()),
      ...opt('where', cleared(input.where)),
      ...opt('period', cleared(input.period)),
      ...(input.year === undefined ? {} : { year: input.year }),
      ...opt('detail', cleared(input.detail)),
      // Replaces rather than appends, and an empty list is how a caller clears
      // them — the same shape every other optional field here has.
      ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
    })
  },

  describe: (input, _out, m) => ({
    title: 'Background updated',
    description: titleOfBackground(m, input.id),
  }),
})

/**
 * A background's own title, for a confirmation line.
 *
 * `displayOf` in `support.ts` is for applications and names an employer and a
 * role; a background has neither. Falling back to the id would put `cred_01H…`
 * in front of somebody about to approve a change to their own CV.
 */
const titleOfBackground = (m: GraphSnapshot, id: NodeId): string =>
  m.node(id, 'background')?.props.title ?? 'this entry'

export const profileBackgroundDelete = defineTool({
  name: 'profile.background.delete',
  title: 'Remove background',
  summary: 'Removes one recorded fact about the person. Use when it was read wrongly.',
  effect: 'delete',
  touches: ['background'],
  input: s.object({ id: s.id('background', { label: 'Entry' }) }),

  run(ctx, input) {
    ctx.require('background', input.id)
    ctx.tx.del(input.id)
  },

  describe: (input, _out, m) => ({
    title: 'Removed',
    description: titleOfBackground(m, input.id),
  }),
})
