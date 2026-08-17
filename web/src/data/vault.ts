/**
 * Everything the Vault holds besides reminders.
 *
 * Seed data only — none of it is persisted until the local store lands. Kept in
 * one module because the three tools share the same shape of idea: something
 * you saved, filed under a bucket, to come back to.
 */

import {
  FILE_BUCKET_VALUES,
  LINK_CATEGORY_VALUES,
  SNIPPET_TAG_VALUES,
} from '@jojo/service/core/model'
import type {
  FileBucket,
  LinkCategory,
  Snippet,
  SnippetTag,
  VaultFile,
  VaultLink,
} from '@jojo/service/core/model'

export type {
  FileBucket,
  FileKind,
  LinkCategory,
  Snippet,
  SnippetTag,
  VaultFile,
  VaultLink,
} from '@jojo/service/core/model'

/* --------------------------------- links --------------------------------- */

/**
 * Spread from the model's value tuple rather than written out again.
 *
 * The list here is the UI's ordering — it is what the category filter renders
 * left to right — and the tuple in the model is what `validate.ts` checks a
 * stored row against. They were the same four strings written twice, which is
 * one deploy away from a category that saves and never appears.
 */
export const LINK_CATEGORIES: LinkCategory[] = [...LINK_CATEGORY_VALUES]

export const vaultLinks: VaultLink[] = [
  {
    id: 'l-rice',
    title: 'Rice — Statistics, tenure-track posting',
    url: 'https://jobs.rice.edu/postings/statistics-tt',
    category: 'Posting',
    note: 'Closes Nov 1 · statements still missing',
    savedOn: '2026-10-10',
  },
  {
    id: 'l-stripe',
    title: 'Stripe — ML engineer, inference',
    url: 'https://stripe.com/jobs/listing/ml-engineer-inference',
    category: 'Posting',
    note: 'Referral from D. Chen',
    savedOn: '2026-10-07',
  },
  {
    id: 'l-uh-dept',
    title: 'UH — Computer Science department overview',
    url: 'https://uh.edu/nsm/computer-science/',
    category: 'Institution',
    note: 'Read before the campus visit',
    savedOn: '2026-10-05',
  },
  {
    id: 'l-baylor-cs',
    title: 'Baylor CS — faculty and research groups',
    url: 'https://cs.baylor.edu/people/faculty',
    category: 'Institution',
    savedOn: '2026-10-05',
  },
  {
    id: 'l-smith',
    title: 'Dr. Smith — search chair, UT Austin',
    url: 'https://cs.utexas.edu/people/faculty/smith',
    category: 'Person',
    note: 'Co-authored with my advisor in 2021',
    savedOn: '2026-09-21',
  },
  {
    id: 'l-chen',
    title: 'D. Chen — referral contact at Stripe',
    url: 'https://www.linkedin.com/in/dchen-example',
    category: 'Person',
    savedOn: '2026-09-21',
  },
  {
    id: 'l-jobtalk',
    title: 'How to give a great job talk',
    url: 'https://matt.might.net/articles/how-to-give-a-job-talk/',
    category: 'Guide',
    note: 'Re-read before the UH rehearsal',
    savedOn: '2026-09-12',
  },
  {
    id: 'l-negotiate',
    title: 'Negotiating an academic startup package',
    url: 'https://theprofessorisin.com/negotiating-startup/',
    category: 'Guide',
    note: 'Relevant to the Baylor offer',
    savedOn: '2026-09-11',
  },
]

/* --------------------------------- files --------------------------------- */

export const FILE_BUCKETS: FileBucket[] = [...FILE_BUCKET_VALUES]

export const vaultFiles: VaultFile[] = [
  {
    id: 'f-rice-ad',
    name: 'Rice-Statistics-position-ad.pdf',
    kind: 'pdf',
    bucket: 'To read',
    size: '184 KB',
    savedOn: '2026-10-10',
    note: 'Full ad, including service expectations',
  },
  {
    id: 'f-uh-packet',
    name: 'UH-campus-visit-packet.pdf',
    kind: 'pdf',
    bucket: 'To read',
    size: '1.2 MB',
    savedOn: '2026-10-08',
    note: 'Schedule, who you meet, parking',
  },
  {
    id: 'f-hiring-paper',
    name: 'Smith-et-al-2024-graph-inference.pdf',
    kind: 'pdf',
    bucket: 'To read',
    size: '2.4 MB',
    savedOn: '2026-10-05',
    note: "Search chair's recent work — worth citing",
  },
  {
    id: 'f-cv',
    name: 'CV-2026-academic.pdf',
    kind: 'pdf',
    bucket: 'Applications',
    size: '212 KB',
    savedOn: '2026-10-09',
  },
  {
    id: 'f-research',
    name: 'Research-statement-v4.doc',
    kind: 'doc',
    bucket: 'Applications',
    size: '68 KB',
    savedOn: '2026-10-09',
    note: 'v4 tightens the funding section',
  },
  {
    id: 'f-teaching',
    name: 'Teaching-statement-v2.doc',
    kind: 'doc',
    bucket: 'Applications',
    size: '54 KB',
    savedOn: '2026-10-05',
  },
  {
    id: 'f-jobtalk',
    name: 'Job-talk-2026.slides',
    kind: 'slides',
    bucket: 'Talks',
    size: '8.6 MB',
    savedOn: '2026-10-07',
    note: '42 slides · runs long, cut the ablations',
  },
  {
    id: 'f-chalk',
    name: 'Chalk-talk-outline.note',
    kind: 'note',
    bucket: 'Talks',
    size: '12 KB',
    savedOn: '2026-10-07',
  },
  {
    id: 'f-refs',
    name: 'Reference-letter-tracker.note',
    kind: 'note',
    bucket: 'Admin',
    size: '8 KB',
    savedOn: '2026-09-28',
    note: 'Third letter for Texas Tech still outstanding',
  },
  {
    id: 'f-i9',
    name: 'Work-authorisation-scans.pdf',
    kind: 'pdf',
    bucket: 'Admin',
    size: '640 KB',
    savedOn: '2026-09-12',
  },
]

/* -------------------------------- snippets -------------------------------- */

export const SNIPPET_TAGS: SnippetTag[] = [...SNIPPET_TAG_VALUES]

/**
 * The answers you retype every time.
 *
 * A job search asks the same handful of questions across dozens of forms, and
 * re-writing them from scratch is where most of the evening goes.
 */
export const snippets: Snippet[] = [
  {
    id: 's-bio-short',
    title: 'Short bio — 50 words',
    tag: 'Bio',
    body: 'I am a final-year PhD candidate working on scalable inference for large graphs. My work combines approximation guarantees with systems-level engineering, and has been deployed in two production settings. I am looking for a role where research questions are chosen by the problems rather than the benchmark.',
  },
  {
    id: 's-why-here',
    title: 'Why this department',
    tag: 'Cover letter',
    body: 'What draws me to [DEPARTMENT] is the overlap between my work on graph inference and the group already working on [AREA]. I would want to teach [COURSE] and to build a lab that takes on problems from [LOCAL CONTEXT] rather than only from the literature.',
  },
  {
    id: 's-teaching',
    title: 'Teaching philosophy — one paragraph',
    tag: 'Cover letter',
    body: 'I teach by making the failure modes visible first. Students remember the algorithm that broke on their own input far longer than the one that worked in a slide, so my courses are built around progressively harder cases students diagnose themselves before I give them the general result.',
  },
  {
    id: 's-diversity',
    title: 'Diversity statement — opening',
    tag: 'Application form',
    body: 'I came to research through a route that most of my peers did not, and it shapes how I run a group: I assume talent is evenly distributed and that access is not. Concretely, that has meant [PROGRAMME] and holding open office hours advertised outside the department.',
  },
  {
    id: 's-availability',
    title: 'Availability and start date',
    tag: 'Application form',
    body: 'I expect to defend in spring 2027 and am available from August 2027. I am able to travel for campus visits at any point in the coming semester, with two weeks of notice.',
  },
  {
    id: 's-followup',
    title: 'Follow-up after no response',
    tag: 'Email',
    body: 'Dear [NAME],\n\nI wanted to check that my application for [ROLE] arrived safely — I submitted it on [DATE] through [PORTAL]. I remain very interested in the position, and I am happy to send anything further that would help the committee.\n\nWith thanks,\n[YOUR NAME]',
  },
  {
    id: 's-thanks',
    title: 'Thank-you after an interview',
    tag: 'Email',
    body: 'Dear [NAME],\n\nThank you for the conversation today — I especially enjoyed discussing [TOPIC] with [PERSON]. It confirmed my sense that this group is where I would want to build the next stage of the work.\n\nPlease do let me know if anything further would be useful.\n\nBest,\n[YOUR NAME]',
  },
  {
    id: 's-decline',
    title: 'Declining an offer politely',
    tag: 'Email',
    body: 'Dear [NAME],\n\nThank you for the offer, and for the care the committee took over my visit. After a great deal of thought I have decided to accept a position elsewhere. I am grateful for the time everyone gave me and hope our paths cross again.\n\nWith best wishes,\n[YOUR NAME]',
  },
]
