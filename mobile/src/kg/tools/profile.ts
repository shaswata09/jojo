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

import type { FileBucket, NodeId, ProfileText } from '@/kg/core/model'
import { s } from '@/kg/core/schema'
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
  title: 'Edit profile',
  summary: 'Saves one field on the profile.',
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
