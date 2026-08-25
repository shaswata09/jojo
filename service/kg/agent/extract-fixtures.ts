/**
 * Four documents about one invented person, and what a correct reading finds.
 *
 * The material `test/live-extract.test.ts` measures the models against. It is
 * here rather than in `test/` because it is data with no environment in it —
 * no clock, no filesystem, no network — and because a unit test uses it too.
 *
 * ## Why one person across four documents
 *
 * Because that is the case the feature exists for and the case that goes wrong.
 * A CV lists papers; a research statement says what the person works ON; a
 * teaching statement says what they do in a classroom; a cover letter restates
 * some of all three and is mostly about somebody else. Reading them separately
 * and merging is the whole design, and a fixture of one CV would measure none
 * of it.
 *
 * ## What `expect` is and is not
 *
 * The entries a careful human reader would file, written down before any model
 * was run. Recall against this is the number that matters — the failure being
 * measured is omission, and precision is checked separately by `forbidden`,
 * which lists the specific wrong answers each document invites.
 *
 * It is deliberately not exhaustive of every word in the text. A model that
 * files "Python" from the skills line is right and so is one that does not
 * bother; what is measured is the entries a person would be annoyed to lose.
 */

/** One thing a correct reading finds: a kind and words that must appear. */
export type Expected = {
  readonly kind: string
  /** Matched case-insensitively against the entry's title and bullets. */
  readonly says: string
  /** What a person would call this, for the report. */
  readonly label: string
}

export type Fixture = {
  readonly id: string
  readonly name: string
  readonly text: string
  readonly expect: readonly Expected[]
  /**
   * Titles that must NOT come back, with why.
   *
   * The precision half, and it is per-document because each kind invites a
   * different wrong answer: a statement invites an intention read as an
   * achievement, and a cover letter invites the employer's qualifications.
   */
  readonly forbidden: readonly { readonly says: string; readonly why: string }[]
}

const CV = `Dr Amara Okonjo
amara.okonjo@example.ac.uk · +44 7700 900123 · Manchester

## Education
PhD, Computer Science, University of Manchester, 2015–2019
  Thesis: Consistency without coordination in geo-replicated stores
MSc, Distributed Systems, University of Edinburgh, 2014–2015, Distinction
BSc, Mathematics, University of Ibadan, 2010–2013, First Class

## Employment
Senior Research Engineer, Cloudflare, 2023–present
  - Led the redesign of the multi-region key-value store serving 40M requests/sec
  - Cut p99 write latency from 180ms to 42ms across 14 regions
  - Mentored four junior engineers through their first on-call rotations
Postdoctoral Researcher, ETH Zürich, 2019–2023
  - Built Aurelia, a causal-consistency runtime now used by three research groups
  - Ran the systems reading group for three years
Research Intern, Microsoft Research Cambridge, Summer 2018

## Publications
Consistency without coordination in geo-replicated stores. OSDI 2021.
A cache that admits it is wrong. NSDI 2020.
Bounded staleness is not enough. SOSP 2022. Best Paper Award.
Causal consistency at the edge. EuroSys 2023.

## Teaching
Distributed Systems (MSc), University of Manchester, 2020–2023
Introduction to Concurrency (BSc), ETH Zürich, 2021
Supervised 6 MSc dissertations and 2 PhD students

## Grants and awards
EPSRC New Investigator Award, £412,000, 2024
SOSP Best Paper Award, 2022
Google PhD Fellowship, 2017

## Service
Programme Committee, OSDI 2023, 2024
Reviewer, TOCS and TPDS
Co-organiser, PaPoC workshop 2022

## Certifications
AWS Certified Solutions Architect – Professional, 2023
Certified Kubernetes Administrator, 2022

## Skills
Rust, Go, C++, Python, Kubernetes, Terraform, PostgreSQL

## Languages
English (native), Igbo (native), German (B2), French (A2)

## Professional membership
Senior Member, ACM
Member, USENIX
`

const RESEARCH = `Research Statement — Amara Okonjo

My research programme sits at the boundary between distributed systems and
programming languages. I work on making weak consistency models usable by
ordinary application programmers, rather than only by the specialists who
design them.

Over the last six years I have built three systems in this area. Aurelia is a
causal-consistency runtime that infers session guarantees from a program's
control flow; it is now used by three research groups outside my own. Corvus is
a static analyser that finds anomalies a given consistency model would permit in
an application, which I developed during my postdoc at ETH Zürich. Most
recently I have been building Tessera, a geo-replicated store that lets an
application declare its invariants and derives the coordination it needs.

Methodologically I work in three ways: formal specification in TLA+, systems
implementation in Rust, and large-scale empirical measurement on production
traces. The measurement work has depended on a long collaboration with
Cloudflare, where I hold an industrial fellowship.

I currently hold an EPSRC New Investigator Award of £412,000, which funds two
doctoral students working on invariant inference.

In the next five years I plan to extend this work to machine-learning serving
infrastructure, and I am seeking funding for a larger group working on
verification of geo-distributed systems. I intend to submit an ERC Starting
Grant application in 2027.
`

const TEACHING = `Teaching Statement — Amara Okonjo

My teaching philosophy begins with a conviction that systems are learned by
building them. I believe students understand replication only when they have
watched their own implementation lose data.

I have taught Distributed Systems at MSc level at the University of Manchester
for four years, redesigning the course around a term-long project in which
students build a replicated log from scratch. I introduced automated
correctness testing to that course, which reduced marking time by half and gave
students same-day feedback. I also taught Introduction to Concurrency at ETH
Zürich.

I have supervised six MSc dissertations and currently co-supervise two doctoral
students. I completed the Advanced Higher Education Teaching Fellowship in
2022, and I hold Fellowship of the Higher Education Academy.

I am committed to widening participation, and I hope in future to develop an
outreach programme for schools in Greater Manchester.
`

const COVER = `Dear Professor Lindqvist,

I am writing to apply for the Lectureship in Computer Systems at the University
of St Andrews, advertised on jobs.ac.uk.

Your department's recent work on verified compilation, and in particular
Professor Chen's CakeML group, is among the strongest in Europe, and the
School's commitment to small-group teaching is exactly the environment in which
I would like to build a research group.

In my current post at Cloudflare I lead the team responsible for the
multi-region key-value store, where I reduced p99 write latency by a factor of
four. Before that, during my postdoc at ETH Zürich, I built Aurelia, a
causal-consistency runtime. I have published at OSDI, NSDI and SOSP, and my
2022 SOSP paper received a Best Paper Award.

I would relish the opportunity to contribute to your Systems Group and to teach
on the MSc in Software Engineering.

Yours sincerely,
Amara Okonjo
`

export const FIXTURES: readonly Fixture[] = [
  {
    id: 'cv',
    name: 'CV-2026-academic.pdf',
    text: CV,
    expect: [
      { kind: 'education', says: 'phd', label: 'the PhD' },
      { kind: 'education', says: 'msc', label: 'the MSc' },
      { kind: 'education', says: 'bsc', label: 'the BSc' },
      { kind: 'employment', says: 'cloudflare', label: 'Cloudflare' },
      { kind: 'employment', says: 'eth', label: 'the ETH postdoc' },
      { kind: 'employment', says: 'microsoft', label: 'the MSR internship' },
      { kind: 'publication', says: 'osdi', label: 'the OSDI paper' },
      { kind: 'publication', says: 'nsdi', label: 'the NSDI paper' },
      { kind: 'publication', says: 'sosp', label: 'the SOSP paper' },
      { kind: 'publication', says: 'eurosys', label: 'the EuroSys paper' },
      { kind: 'teaching', says: 'distributed systems', label: 'the DS course' },
      { kind: 'teaching', says: 'concurrency', label: 'the concurrency course' },
      { kind: 'grant', says: 'epsrc', label: 'the EPSRC award' },
      { kind: 'award', says: 'best paper', label: 'the best-paper award' },
      { kind: 'award', says: 'fellowship', label: 'the Google fellowship' },
      { kind: 'service', says: 'programme committee', label: 'the PC service' },
      { kind: 'certification', says: 'aws', label: 'the AWS certification' },
      { kind: 'certification', says: 'kubernetes', label: 'the CKA' },
      { kind: 'skill', says: 'rust', label: 'Rust' },
      { kind: 'skill', says: 'terraform', label: 'Terraform' },
      { kind: 'language', says: 'german', label: 'German' },
      { kind: 'language', says: 'igbo', label: 'Igbo' },
      { kind: 'membership', says: 'acm', label: 'the ACM membership' },
    ],
    forbidden: [],
  },
  {
    id: 'research-statement',
    name: 'Research-statement-v4.doc',
    text: RESEARCH,
    expect: [
      { kind: 'project', says: 'aurelia', label: 'Aurelia' },
      { kind: 'project', says: 'corvus', label: 'Corvus' },
      { kind: 'project', says: 'tessera', label: 'Tessera' },
      { kind: 'skill', says: 'tla', label: 'TLA+' },
      { kind: 'skill', says: 'rust', label: 'Rust' },
      { kind: 'grant', says: 'epsrc', label: 'the EPSRC award' },
    ],
    forbidden: [
      {
        says: 'erc starting grant',
        why: 'an application they intend to submit in 2027, not a grant they hold',
      },
      {
        says: 'machine-learning serving',
        why: 'work they plan to do in the next five years, not work they have done',
      },
    ],
  },
  {
    id: 'teaching-statement',
    name: 'Teaching-statement-v2.doc',
    text: TEACHING,
    expect: [
      { kind: 'teaching', says: 'distributed systems', label: 'the DS course' },
      { kind: 'teaching', says: 'concurrency', label: 'the concurrency course' },
      { kind: 'teaching', says: 'supervis', label: 'the supervision' },
      { kind: 'certification', says: 'higher education', label: 'the HEA fellowship' },
    ],
    forbidden: [
      {
        says: 'outreach programme',
        why: 'something they hope to develop in future, not something they have done',
      },
      {
        says: 'students understand replication',
        why: 'a belief about how people learn, not a fact about this person',
      },
    ],
  },
  {
    id: 'cover-letter',
    name: 'Cover letter — St Andrews.pdf',
    text: COVER,
    expect: [
      { kind: 'employment', says: 'cloudflare', label: 'the Cloudflare post' },
      { kind: 'project', says: 'aurelia', label: 'Aurelia' },
      { kind: 'award', says: 'best paper', label: 'the best-paper award' },
    ],
    forbidden: [
      {
        says: 'cakeml',
        why: 'the EMPLOYER’s research group — filing it makes their work the applicant’s',
      },
      {
        says: 'verified compilation',
        why: 'what the department does, not what this person does',
      },
      {
        says: 'lectureship',
        why: 'the job being applied for, not a post held',
      },
      {
        says: 'msc in software engineering',
        why: 'a course they would like to teach on, at a university that has not hired them',
      },
    ],
  },
]
