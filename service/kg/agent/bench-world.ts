/**
 * The job search a benchmarked agent is dropped into. L3.
 *
 * Every conversation in `bench-conversations.ts` runs against this, and the
 * whole point is that it is a REAL store rather than a fixture object: the
 * world is built by running jojo's own tools, so the ids are real ids, the
 * edges are real edges, and a model that looks something up gets what a person
 * would have got.
 *
 * ## Why it is a list of tool calls rather than a pile of nodes
 *
 * Because a hand-built graph can be inconsistent in ways the app cannot produce
 * — an application with no organisation, a keyword edge pointing at nothing —
 * and an agent that then behaves oddly is being blamed for the fixture. Running
 * the tools means the world is by construction a world jojo could have reached.
 *
 * It also means the setup exercises the tools, so a benchmark that suddenly
 * cannot build its own world is telling you something before it tells you
 * anything about a model.
 *
 * ## The two ambiguities are deliberate
 *
 * **Two Rice applications** (an assistant professorship and a postdoc) and
 * **two UT campuses** (Austin and Dallas). Almost every published tool-calling
 * benchmark gives the model an unambiguous world, which quietly removes the
 * hardest thing about acting on somebody's records: "update my Rice
 * application" has two answers here, and the correct behaviour is to look,
 * notice, and ask — not to pick one.
 *
 * A model that scores well on a world with one Rice application has not been
 * tested on the case that actually loses somebody's data.
 *
 * ## The clock
 *
 * Pinned. `BENCH_TODAY` is what the host's `now` returns, so "next Tuesday" and
 * "this month" mean the same thing on every run — and a benchmark whose score
 * moves because the wall clock moved is a benchmark nobody can bisect.
 */

/** The day every conversation happens on. Pinned; see the header. */
export const BENCH_TODAY = '2026-09-14'
export const BENCH_NOW = `${BENCH_TODAY}T09:00:00.000Z`

/** One step of the setup: a tool and the input it is given. */
export type WorldStep = {
  readonly tool: string
  readonly input: Record<string, unknown>
  /**
   * A name this step's output can be referred to by, later in the setup.
   *
   * The setup needs ids it cannot know in advance — attaching a keyword needs
   * the keyword that a previous step made. A step's output is stashed under
   * this name and `$name` in a later input is replaced with it.
   */
  readonly as?: string
}

/**
 * The world, in the order it is built.
 *
 * Organisations are NOT created explicitly: `application.create` takes the
 * employer as free text and mints the org itself. Creating them up front would
 * be building a world through a door the app does not have.
 */
export const WORLD: readonly WorldStep[] = [
  /* ------------------------------ keywords ------------------------------ */
  { tool: 'keyword.create', input: { name: 'systems' }, as: 'kw.systems' },
  { tool: 'keyword.create', input: { name: 'teaching' }, as: 'kw.teaching' },
  { tool: 'keyword.create', input: { name: 'needs-referee' }, as: 'kw.referee' },

  /* ---------------------------- applications ---------------------------- */
  {
    tool: 'application.create',
    input: {
      org: 'Rice University',
      role: 'Assistant Professor, Computer Science',
      roleTag: 'Assistant Professor',
      stage: 'submitted',
      deadline: '2026-09-30',
    },
    as: 'app.rice.ap',
  },
  {
    // The first ambiguity: same employer, different role. "My Rice
    // application" is not a well-formed request against this world.
    tool: 'application.create',
    input: {
      org: 'Rice University',
      role: 'Postdoctoral Fellow, Physics',
      roleTag: 'Postdoc',
      stage: 'draft',
    },
    as: 'app.rice.postdoc',
  },
  {
    tool: 'application.create',
    input: {
      org: 'Baylor College of Medicine',
      role: 'Research Scientist',
      roleTag: 'Researcher',
      stage: 'interview',
    },
    as: 'app.baylor',
  },
  {
    // The second ambiguity: two UT campuses. "The UT one" has two answers.
    tool: 'application.create',
    input: {
      org: 'UT Austin',
      role: 'Assistant Professor, Systems',
      roleTag: 'Assistant Professor',
      stage: 'submitted',
    },
    as: 'app.utaustin',
  },
  {
    tool: 'application.create',
    input: {
      org: 'UT Dallas',
      role: 'Lecturer, Computer Science',
      roleTag: 'Lecturer',
      // Closed with an outcome, which is how this app spells "rejected" —
      // `stage` is where you are, `outcome` is how it ended.
      stage: 'closed',
      outcome: 'rejected',
    },
    as: 'app.utdallas',
  },
  {
    tool: 'application.create',
    input: {
      org: 'Stripe',
      role: 'Systems Engineer',
      roleTag: 'ML Engineer',
      stage: 'offer',
    },
    as: 'app.stripe',
  },

  /* ------------------------------ timeline ------------------------------ */
  {
    tool: 'timeline.item.create',
    input: {
      title: 'Baylor — second interview',
      date: '2026-09-22',
      kind: 'interview',
      applicationIds: ['$app.baylor'],
    },
    as: 'ti.baylor',
  },
  {
    tool: 'timeline.item.create',
    input: {
      title: 'Chase UT Austin for a decision',
      date: '2026-09-08',
      kind: 'follow-up',
      remind: true,
      applicationIds: ['$app.utaustin'],
    },
    as: 'ti.chase',
  },
  {
    tool: 'timeline.item.create',
    input: {
      title: 'Stripe — respond to offer',
      date: '2026-09-19',
      kind: 'deadline',
      remind: true,
      applicationIds: ['$app.stripe'],
    },
    as: 'ti.stripe',
  },

  /* -------------------------------- vault ------------------------------- */
  {
    tool: 'vault.file.add',
    input: {
      files: [
        { name: 'CV-2026.pdf', kind: 'pdf', bucket: 'Applications', size: '412 KB' },
        { name: 'Research-statement.pdf', kind: 'pdf', bucket: 'Applications', size: '208 KB' },
        { name: 'Teaching-statement.pdf', kind: 'pdf', bucket: 'Applications', size: '196 KB' },
      ],
    },
    as: 'file.cv',
  },
  {
    tool: 'vault.link.save',
    input: {
      title: 'Rice CS faculty openings',
      url: 'https://example.edu/rice/openings',
      category: 'Posting',
    },
    as: 'link.rice',
  },
  {
    tool: 'vault.snippet.create',
    input: {
      title: 'Follow-up after interview',
      tag: 'Email',
      body: 'Thank you for the conversation on [DATE]. I remain very interested in the role.',
    },
    as: 'snip.followup',
  },

  /* ------------------------- deliberate gaps ---------------------------- */
  /*
   * Everything below exists to be MISSING something, because "what have I not
   * done" is a question a job tracker is asked constantly and one an agent can
   * only answer by comparing records against each other.
   *
   * A benchmark whose world is tidy cannot ask it at all.
   */
  {
    // Saved months ago, never turned into an application, never dismissed.
    tool: 'scout.posting.save',
    input: {
      url: 'https://example.edu/utsw/faculty-2026',
      title: 'UT Southwestern — Assistant Professor, Computational Biology',
      savedOn: '2026-07-02',
    },
    as: 'posting.utsw',
  },
  {
    tool: 'scout.posting.save',
    input: {
      url: 'https://example.com/anthropic/research-engineer',
      title: 'Anthropic — Research Engineer',
      savedOn: '2026-09-11',
    },
    as: 'posting.anthropic',
  },
  {
    // A pipeline that has never run. The scout screen shows it as idle.
    tool: 'scout.pipeline.create',
    input: {
      name: 'Texas faculty postings',
      source: 'https://example.edu/boards/texas',
      schedule: 'weekly',
      filter: 'assistant professor systems',
      enabled: true,
    },
    as: 'pipe.texas',
  },
  {
    // Disabled, so it will never run at all — a different kind of gap.
    tool: 'scout.pipeline.create',
    input: {
      name: 'Industry research roles',
      source: 'https://example.com/boards/industry',
      schedule: 'daily',
      filter: 'research engineer',
      enabled: false,
    },
    as: 'pipe.industry',
  },
  {
    // A strong match nobody has acted on.
    tool: 'scout.match.save',
    input: {
      role: 'Assistant Professor, Systems — Georgia Tech',
      detail: 'Systems and networking group, teaching load 2-1.',
      fit: 88,
    },
    as: 'match.gatech',
  },
  {
    tool: 'scout.match.save',
    input: {
      role: 'Lecturer, Data Science — Rice',
      detail: 'Teaching-focused, renewable three-year.',
      fit: 41,
    },
    as: 'match.rice.lecturer',
  },
  {
    // An orphan: a document filed under no application at all.
    tool: 'vault.file.add',
    input: {
      files: [{ name: 'Old-CV-2024.pdf', kind: 'pdf', bucket: 'Applications', size: '388 KB' }],
    },
    as: 'file.oldcv',
  },

  /* ------------------------------- tagging ------------------------------ */
  { tool: 'keyword.attach', input: { record: '$app.utaustin', keyword: '$kw.systems' } },
  { tool: 'keyword.attach', input: { record: '$app.stripe', keyword: '$kw.systems' } },
  { tool: 'keyword.attach', input: { record: '$app.rice.ap', keyword: '$kw.teaching' } },
]

/**
 * What is actually inside the stored documents.
 *
 * jojo never reads a document unless asked: `vault.file.read` goes out to a
 * converter and turns a PDF into text. That converter is a real network service
 * in the app and a lookup in this table here, which is what makes "read my CV
 * and tell me what is in it" a question with a checkable answer rather than an
 * invitation to make something up.
 *
 * The contents are written to be ANSWERABLE and to contain facts that are not
 * anywhere else in the store — the referee names, the specific dates. A model
 * that answers correctly about them must have opened the file, because there is
 * nowhere else the answer could have come from. That is the whole design of the
 * document category: no shortcut is available.
 *
 * Keyed by file name rather than id, because ids do not exist until the world
 * is built.
 */
export const DOCUMENTS: Readonly<Record<string, string>> = {
  'CV-2026.pdf': [
    '# Dr A. Candidate',
    '',
    '## Education',
    'PhD, Computer Science, University of Illinois at Urbana-Champaign, 2021.',
    'MSc, Computer Science, University of Edinburgh, 2016.',
    '',
    '## Employment',
    'Postdoctoral Researcher, Carnegie Mellon University, 2021–2024.',
    'Research Engineer, Cloudflare, 2024–present.',
    '',
    '## Selected publications',
    'Consistent snapshots without coordination. OSDI 2023.',
    'A cache that admits it is wrong. NSDI 2022.',
    '',
    '## Referees',
    'Prof. Marta Oyelaran, Carnegie Mellon University.',
    'Dr Idris Whitfield, Cloudflare.',
  ].join('\n'),

  'Research-statement.pdf': [
    '# Research statement',
    '',
    'My work is on storage systems that stay correct when the network does not.',
    'Three threads: coordination-free snapshots, cache coherence under partition,',
    'and tooling that makes the resulting failures legible to an operator.',
    '',
    'Over the next five years I intend to build a group around the third thread,',
    'which is the least studied and the one practitioners ask about most.',
  ].join('\n'),

  'Teaching-statement.pdf': [
    '# Teaching statement',
    '',
    'I have taught Distributed Systems (graduate, 3 years) and Introduction to',
    'Programming (undergraduate, 2 years). My teaching evaluations average 4.6/5.',
    '',
    'I want to develop a project-based operating systems course in which students',
    'build a small kernel over a term.',
  ].join('\n'),

  'Old-CV-2024.pdf': [
    '# Dr A. Candidate — 2024',
    '',
    'An older version. Lists the Cloudflare role as beginning in 2024 and has no',
    'OSDI 2023 publication on it, because it predates the camera-ready.',
  ].join('\n'),
}

/**
 * What the world contains once it is built, for the setup to check itself.
 *
 * A benchmark that silently built a different world than it meant to would
 * report model failures that are its own. These are asserted before a single
 * conversation runs.
 */
export const WORLD_SHAPE = {
  application: 6,
  posting: 2,
  pipeline: 2,
  match: 2,
  /*
   * FIVE, not six. The two Rice applications share one organisation, because
   * `application.create` routes the employer through `org.ensure` — which hands
   * back the existing record rather than making a second.
   *
   * Worth pinning precisely because it is the ambiguity the suite is built on,
   * seen from the other side: one employer, two applications.
   */
  organisation: 5,
  keyword: 3,
  /*
   * FOUR, not three. Three are created explicitly below; the fourth is minted
   * by `application.create` itself, because the Rice assistant professorship
   * carries a `deadline` and the tool files a dated item for it.
   *
   * That composition is exactly what `COMPOSES` in `tool-graph.ts` records, and
   * finding it here — by the world refusing to be the shape it claimed — is the
   * setup's self-check earning its place.
   */
  timelineItem: 4,
  file: 4,
  link: 1,
  snippet: 1,
  /*
   * ZERO, and declared rather than omitted.
   *
   * The world seeds nothing about the person themselves — that is what the
   * `profile` conversations build. Leaving these out is not the same as saying
   * none: `bench-fixtures` refuses a `count` check on a type the world never
   * names, so an omitted type is indistinguishable from a typo, and the
   * conversations that most needed counting were the ones it turned away.
   *
   * Counting from zero is exactly what those checks want. `profile-relate-two-facts`
   * asserts two backgrounds and one claim, and both numbers are only meaningful
   * because the starting point is stated here.
   */
  background: 0,
  claim: 0,
} as const
