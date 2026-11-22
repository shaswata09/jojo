/**
 * A second person, and the postings to weigh both people against.
 *
 * `extract-fixtures.ts` holds one invented person — a systems researcher —
 * and measures whether a model reads their documents completely. This file
 * exists for the half that comes after: whether the whole chain, documents to
 * facts to a posting's requirements to a verdict, says something TRUE about
 * how a person fits a job. That needs a second person in a different field,
 * so that the same posting can be a strong fit for one and a stretch for the
 * other, and it needs postings with a ground truth of what they ask for.
 *
 * ## The person
 *
 * Dr Priya Raghunathan, an AI/ML researcher at the end of a postdoc, applying
 * for tenure-track faculty posts — the case the report that prompted this was
 * about ("Tenure-Track Faculty in Artificial Intelligence", HigherEdJobs,
 * 2026-09-12). Four documents, as `extract-fixtures.ts` has them, with what a
 * careful human reader would file from each and the wrong answers each
 * invites.
 *
 * ## The postings
 *
 * Three, chosen for what they should do to the two people:
 *
 *   - `ai-faculty`: a HigherEdJobs-style tenure-track AI post. Priya should be
 *     at least worth tailoring; Amara, the systems researcher, should not be
 *     strong.
 *   - `cs-faculty`: an invented university posting built on the structure of
 *     a real one, which lists expectations without "Required:" headings and
 *     says in prose that AI/ML-only candidates will not be considered. A test
 *     of the reader's judgement about what is essential, and a posting no
 *     AI-only candidate should come out of as strong. It was the real page,
 *     verbatim, until 2026-11-21; the comment on `CS_FACULTY` says why that
 *     changed and what was kept.
 *   - `ml-engineer`: an industry ML platform role in the style of a Greenhouse
 *     board, with explicit Required/Preferred headings.
 *
 * Every expectation below was written before any model ran.
 */

import type { Fixture } from './extract-fixtures'

export type ExpectedRequirement = {
  /** Words that must appear in ONE requirement's text, folded. */
  readonly says: string
  readonly essential: boolean
  readonly label: string
}

export type PostingFixture = {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly text: string
  readonly expect: readonly ExpectedRequirement[]
}

/* ------------------------------ the person -------------------------------- */

const CV = `Dr Priya Raghunathan
Postdoctoral Researcher, Allen Institute for AI (AI2), Seattle
priya@example.org · Seattle, WA

## Education

PhD, Computer Science — University of Washington, 2019–2024
Thesis: Robust and calibrated language models under distribution shift. Advisor: Prof. Daniel Weld.

MS, Computer Science — Indian Institute of Technology Madras, 2015–2017

BTech, Computer Science and Engineering — National Institute of Technology, Tiruchirappalli, 2011–2015

## Employment

Postdoctoral Researcher — Allen Institute for AI (AI2), Seattle, 2024–present
- Lead the Trustworthy Language Models project: calibration and selective prediction for instruction-tuned models.
- Built the evaluation harness used across three AI2 teams; 40 internal users.
- Supervise two research interns and a masters student.

Research Intern — Google DeepMind, London, Summer 2022
- Retrieval-augmented fine-tuning for factuality; results in the NeurIPS 2023 paper below.

Applied Scientist Intern — Amazon Alexa AI, Summer 2021
- Data-efficient intent classification with 4% of the labelled data at parity accuracy.

Software Engineer — Flipkart, Bangalore, 2015–2017
- Search ranking services in Java and Python; on-call for a 20-node Solr cluster.

## Publications

Raghunathan, P., Weld, D. Selective prediction for instruction-tuned language models. ICLR 2024.
Raghunathan, P., Ferreira, L., Weld, D. Retrieval-augmented fine-tuning improves factual robustness. NeurIPS 2023.
Raghunathan, P., Chen, M. Calibration under covariate shift for text classifiers. ICML 2022.
Raghunathan, P., Osei, K., Weld, D. Contrastive data augmentation for low-resource NLP. ACL 2023.
Raghunathan, P. Prompt sensitivity in few-shot classification. EMNLP 2021 (Findings). Honorable Mention, Best Paper.

## Grants and fellowships

NSF Graduate Research Fellowship, 2019–2022, $138,000.
AI2 Young Investigator seed grant, 2025, $50,000 — evaluation of calibration in deployed assistants.

## Awards

Best Paper Honorable Mention, EMNLP 2021 Findings.
Outstanding Reviewer, ACL 2023.

## Teaching

Instructor — Summer Machine Learning Bootcamp, University of Washington, 2022. Designed the 6-week curriculum; 45 students.
Teaching Assistant — CSE 447 Natural Language Processing, University of Washington, Winter 2021.
Guest lecturer — CSE 599 Trustworthy Machine Learning, 2023.

## Service

Area Chair — ACL 2025.
Reviewer — NeurIPS 2022–2024, ICML 2023–2024, ACL 2022–2024.
Co-organiser — Workshop on Robust NLP, EMNLP 2023.

## Skills

Python, PyTorch, JAX, CUDA, distributed training (FSDP, DeepSpeed), Hugging Face, Kubernetes, SQL.

## Languages

Tamil (native), Hindi (fluent), English (fluent), German (basic).

## Memberships

ACM, ACL.
`

const RESEARCH = `Research Statement — Priya Raghunathan

My research asks a simple question of large language models: when should they be trusted? I work on calibration, selective prediction and robustness under distribution shift, so that a model can say "I do not know" at the right moments and its confidence means something to the person reading it.

My PhD thesis at the University of Washington developed calibration methods for text classifiers under covariate shift (ICML 2022) and extended them to instruction-tuned models, where I showed that selective prediction — abstaining on a chosen fraction of inputs — can halve the error on the answers a model does give (ICLR 2024). During an internship at Google DeepMind I built a retrieval-augmented fine-tuning method that improved factual robustness on out-of-distribution questions, published at NeurIPS 2023.

As a postdoctoral researcher at the Allen Institute for AI I lead the Trustworthy Language Models project. The evaluation harness we built is used by three teams at the institute, and the AI2 Young Investigator seed grant ($50,000) I was awarded in 2025 funds its extension to deployed assistants.

Looking ahead, I plan to build a research group on trustworthy AI whose first programme is calibration for multi-step reasoning: a model that reasons in five steps should know which step it is unsure of. I intend to apply for an NSF CAREER award in my second year to support this, and I hope to develop a benchmark for stepwise uncertainty that the community can adopt. I am also seeking collaborators in the health sciences, where a calibrated model is the difference between a useful tool and a dangerous one.
`

const TEACHING = `Teaching Statement — Priya Raghunathan

I believe students learn machine learning by building it. A gradient computed by hand once is understood forever; a library call is not.

That belief shaped the Summer Machine Learning Bootcamp I designed and taught at the University of Washington in 2022: six weeks, forty-five students, every week ending with a working system the students had built from primitives before being shown the library that does it for them. Course evaluations averaged 4.7 of 5, and eleven of the students went on to research positions in the department.

As a teaching assistant for CSE 447, Natural Language Processing, in 2021, I ran the weekly sections and rewrote the sequence-labelling assignment so that students implemented the Viterbi algorithm before using a tagger. In 2023 I gave a guest lecture on calibration in the graduate Trustworthy Machine Learning course.

I supervise two research interns and a masters student at AI2, and I have found that the same principle holds in mentoring: a student who has reproduced a paper's main result understands its claims in a way no reading group achieves.

I would be glad to teach machine learning, natural language processing and an introductory programming course, and I hope to develop a graduate seminar on trustworthy AI.
`

const COVER = `Dear Professor Alvarez,

I am writing to apply for the Tenure-Track Assistant Professor position in Artificial Intelligence in the Department of Computer Science at Meridian State University.

I am a postdoctoral researcher at the Allen Institute for AI, where I lead the Trustworthy Language Models project, and I completed my PhD in Computer Science at the University of Washington in 2024. My work on calibration and selective prediction for language models has appeared at ICLR, NeurIPS, ICML and ACL, and my NeurIPS 2023 paper on retrieval-augmented fine-tuning came out of an internship at Google DeepMind. I held an NSF Graduate Research Fellowship through my PhD.

Your department's new Center for Responsible AI is the reason I am applying. Its work on algorithmic auditing is exactly the setting in which calibrated models matter, and I would hope to contribute to its seminar series and to the MS in Data Science program, whose machine learning course I would be glad to teach.

I have supervised interns and a masters student at AI2 and designed and taught a six-week machine learning bootcamp at the University of Washington. I look forward to discussing how my research programme on trustworthy AI could grow at Meridian State.

Yours sincerely,
Priya Raghunathan
`

export const PRIYA: readonly Fixture[] = [
  {
    id: 'priya-cv',
    name: 'Raghunathan-CV-2026.pdf',
    text: CV,
    expect: [
      { kind: 'education', says: 'phd', label: 'the PhD' },
      { kind: 'education', says: 'ms', label: 'the MS' },
      { kind: 'education', says: 'btech', label: 'the BTech' },
      { kind: 'employment', says: 'allen institute', label: 'the AI2 postdoc' },
      { kind: 'employment', says: 'deepmind', label: 'the DeepMind internship' },
      { kind: 'employment', says: 'amazon', label: 'the Amazon internship' },
      { kind: 'employment', says: 'flipkart', label: 'Flipkart' },
      { kind: 'publication', says: 'iclr', label: 'the ICLR paper' },
      { kind: 'publication', says: 'neurips', label: 'the NeurIPS paper' },
      { kind: 'publication', says: 'icml', label: 'the ICML paper' },
      { kind: 'publication', says: 'acl', label: 'the ACL paper' },
      { kind: 'publication', says: 'emnlp', label: 'the EMNLP paper' },
      { kind: 'grant', says: 'nsf', label: 'the NSF fellowship' },
      { kind: 'grant', says: 'young investigator', label: 'the AI2 seed grant' },
      { kind: 'award', says: 'best paper', label: 'the best-paper mention' },
      { kind: 'award', says: 'outstanding reviewer', label: 'the reviewer award' },
      { kind: 'teaching', says: 'bootcamp', label: 'the bootcamp' },
      { kind: 'teaching', says: 'natural language processing', label: 'the NLP TA post' },
      { kind: 'service', says: 'area chair', label: 'the area chair role' },
      { kind: 'service', says: 'workshop', label: 'the workshop' },
      { kind: 'skill', says: 'pytorch', label: 'PyTorch' },
      { kind: 'skill', says: 'distributed training', label: 'distributed training' },
      { kind: 'language', says: 'tamil', label: 'Tamil' },
      { kind: 'membership', says: 'acl', label: 'the ACL membership' },
    ],
    forbidden: [],
  },
  {
    id: 'priya-research-statement',
    name: 'Raghunathan-Research-Statement.pdf',
    text: RESEARCH,
    expect: [
      { kind: 'publication', says: 'icml', label: 'the ICML paper' },
      { kind: 'publication', says: 'iclr', label: 'the ICLR paper' },
      { kind: 'publication', says: 'neurips', label: 'the NeurIPS paper' },
      { kind: 'project', says: 'trustworthy language models', label: 'the AI2 project' },
      { kind: 'grant', says: 'young investigator', label: 'the seed grant' },
    ],
    forbidden: [
      { says: 'career award', why: 'an application they intend to make, not a grant they hold' },
      {
        says: 'multi-step reasoning',
        why: 'the first programme of a group they plan to build, not work they have done',
      },
      { says: 'health sciences', why: 'collaborators they are seeking, not a collaboration held' },
    ],
  },
  {
    id: 'priya-teaching-statement',
    name: 'Raghunathan-Teaching-Statement.pdf',
    text: TEACHING,
    expect: [
      { kind: 'teaching', says: 'bootcamp', label: 'the bootcamp' },
      { kind: 'teaching', says: 'cse 447', label: 'the NLP TA post' },
      { kind: 'teaching', says: 'supervis', label: 'the supervision' },
    ],
    forbidden: [
      { says: 'graduate seminar', why: 'a course they hope to develop, not one they have taught' },
      {
        says: 'learn machine learning by building',
        why: 'a belief about teaching, not a fact about the person',
      },
    ],
  },
  {
    id: 'priya-cover-letter',
    name: 'Cover letter — Meridian State.pdf',
    text: COVER,
    expect: [
      { kind: 'employment', says: 'allen institute', label: 'the AI2 post' },
      { kind: 'education', says: 'phd', label: 'the PhD' },
      { kind: 'grant', says: 'nsf', label: 'the NSF fellowship' },
    ],
    forbidden: [
      {
        says: 'responsible ai',
        why: 'the EMPLOYER’s centre — filing it makes their work the applicant’s',
      },
      { says: 'algorithmic auditing', why: 'what the department does, not what this person does' },
      {
        says: 'data science program',
        why: 'a course they would like to teach, at a university that has not hired them',
      },
      { says: 'assistant professor', why: 'the job being applied for, not a post held' },
    ],
  },
]

/* ------------------------------ the postings ------------------------------ */

const AI_FACULTY = `Tenure-Track Faculty in Artificial Intelligence
Meridian State University
Department of Computer Science — Meridian, OR

Type: Full-Time
Posted: 2 weeks ago
Category: Computer Science

Description:
The Department of Computer Science at Meridian State University invites applications for a tenure-track faculty position in Artificial Intelligence at the rank of Assistant Professor, beginning September 2027. We seek candidates whose research advances the foundations or the trustworthy application of machine learning, including large language models, natural language processing, machine learning systems, and responsible AI. The successful candidate will join a department of 28 faculty and the university's new Center for Responsible AI.

Responsibilities include establishing an externally funded research program, teaching undergraduate and graduate courses in computer science, supervising graduate students, and contributing to departmental and university service.

Required Qualifications:
- A PhD in Computer Science or a closely related field by the start date.
- A record of research in artificial intelligence or machine learning, demonstrated through publications.
- Evidence of potential to secure external research funding.
- A commitment to teaching at the undergraduate and graduate levels.

Preferred Qualifications:
- Postdoctoral research experience.
- Publications in top-tier venues such as NeurIPS, ICML, ICLR, or ACL.
- Experience mentoring or supervising students.
- Research in trustworthy, robust, or responsible AI.
- Experience with interdisciplinary collaboration.

Application Instructions:
Submit a cover letter, curriculum vitae, research statement, teaching statement, and the names of three references through the university's online portal. Review of applications begins November 15, 2026, and continues until the positions are filled.

Meridian State University is an equal opportunity employer and welcomes applications from all qualified candidates. The university is committed to building a diverse faculty.

Salary: Commensurate with experience. Benefits include health insurance, retirement contributions, and relocation assistance.
`

/*
 * An INVENTED posting with the shape of a real one.
 *
 * Until 2026-11-21 this constant held a real university's posting, copied
 * verbatim from HigherEdJobs on 2026-09-12 — named officials, the search
 * chair's email and all. The repository is public and Apache-2.0, and jojo
 * cannot license somebody else's text, nor publish a stranger's address. So the
 * institution, the people, the places and every sentence are now made up.
 *
 * What was kept is what the test was for: the reading is hard in the same ways.
 * Expectations are a numbered list inside one sentence, and there is no
 * "Required:" heading anywhere. The rule that matters most to an AI-only
 * applicant is a sentence of prose, not a bullet. The doctorate is spelled
 * "Ph. D." where it is asked for, so a reader that keys on "PhD" has to find it
 * by meaning (the folded word still appears once, in the college's list of
 * programmes, which is all the fixture guard checks). Most of the page is
 * campus and city promotion that asks for nothing, and the scraped line breaks
 * around the institution's name and acronym are left in, because a captured
 * page arrives that way.
 *
 * Results from runs before that date read the real text under the id
 * `utk-cs`; they are not comparable with runs against this one.
 */
const CS_FACULTY = `Description:
Larkspur Valley University
 (LVU) invites applications for two tenure-track faculty positions in the Department of Computing and Electrical Engineering (
CEE
) at the rank of Assistant Professor. The search gives first priority to candidates working in security and privacy, computer graphics (including VR/AR), programming languages, robotics, or human-computer interaction. Excellent applicants from other areas are also welcome. Applicants whose research is solely in AI/ML will not be considered for this search.
Faculty hired in this search will be expected to (1) carry out and publish scholarly research; (2) seek external funding for an active research program; (3) teach undergraduate and graduate courses in computer science and allied areas; (4) mentor graduate students; and (5) take part in departmental service.
About the University, College, Department, and Larkspur
LVU
 is the state's principal public research university and works closely with a nearby national laboratory, where a number of LVU faculty hold joint appointments or run joint projects.
The College of Engineering
 (CoE) has grown quickly over the last several years, adding more than two dozen faculty at every rank through a sustained hiring initiative. Research spending, enrollment and incoming student preparation have all reached new highs in the last three years. Partnerships with the national laboratory and with regional manufacturers give faculty and students access to shared instruments, testbeds and internships. Recent additions to campus include a new engineering building, an advanced manufacturing center, and a fabrication facility, with a further laboratory building for bioengineering in the planning stage.
CoE has about 200 tenure-line faculty and roughly 80 teaching and research faculty across nine departments, and offers 11 bachelor's, 16 master's, and 15 PhD programs. The college also runs a satellite research campus focused on aerospace, eight research centers and three interdisciplinary institutes. It enrolls roughly 4,500 undergraduate and 1,400 graduate students, and its faculty have received more than thirty early-career awards from federal agencies and private foundations in the past decade.
CEE
 at LVU has about 50 tenure-line faculty, several members of national academies, more than a dozen IEEE Fellows, and more than a dozen early-career award recipients. The department enrolls over 1,000 undergraduates and over 400 graduate students across majors in Electrical Engineering, Computer Engineering, and Computer Science, and offers minors in computer science, cybersecurity, data center operations, and machine learning. New faculty will be expected to help the department continue to grow.
Larkspur is a mid-sized city with a walkable downtown, a lively music and restaurant scene, distinctive neighborhoods, and easy access to rivers, lakes and mountain trails, with cultural festivals throughout the year. Several larger cities are within a half-day's drive, and the regional airport offers nonstop service to around twenty major US airports.
The surrounding area has well-regarded public schools, a highly educated population, and a cost of living well below the national average, and it regularly appears on national lists of good places to live.
Qualifications:
Applicants must hold a Ph. D. in Computer Science, or a closely related field, by the start of the appointment.
The successful candidate should show the potential to build an independent research program, obtain external funding, and collaborate across disciplines. The candidate should also show effective, high-quality teaching and the ability to mentor undergraduate and graduate students well.
Application Instructions:
For full consideration, apply by October 15, 2026. Review will continue until the positions are filled. Please submit the following through the university's application portal:
Cover Letter
Curriculum Vitae
Research Statement
Teaching Statement
Names and Contact Information of Three References
Questions may be sent to the chair of the search committee (
cee-search@example.edu
). 
 Larkspur Valley University is an equal opportunity and affirmative action employer. All qualified applicants will receive equal consideration for employment without regard to race, color, national origin, religion, sex, pregnancy, marital status, sexual orientation, gender identity, age, disability, or veteran status. 
Questions about discrimination or requests for a disability accommodation should be directed to the university's equal opportunity office.
`

const ML_ENGINEER = `Machine Learning Engineer, LLM Platform
Northwind Labs · Seattle, WA (hybrid) · Full-time

About the role
Northwind Labs builds the inference and fine-tuning platform behind three customer-facing assistants. You will join the LLM Platform team and own the training side of that platform: the pipelines that fine-tune, evaluate and ship models to production every week.

What you will do
- Design and run distributed training and fine-tuning jobs across multi-node GPU clusters.
- Build evaluation harnesses that catch regressions before a model ships.
- Work with the serving team to move models from research checkpoints to production endpoints.
- Mentor engineers joining the team.

Required
- 3+ years building machine learning systems in production.
- Strong Python, and deep familiarity with PyTorch.
- Hands-on experience with distributed training (FSDP, DeepSpeed, or Megatron).
- A track record of shipping ML models to production and keeping them healthy.

Preferred
- Experience fine-tuning large language models (instruction tuning, RLHF, LoRA).
- Experience with Kubernetes and cloud GPU infrastructure (AWS or GCP).
- Publications at machine learning venues.
- MS or PhD in Computer Science or a related field.

What we offer
- Salary range $190,000–$240,000 plus equity.
- Health, dental and vision insurance; 401(k) matching; 20 days of paid leave.
- A dog-friendly office three blocks from the water.

Northwind Labs is an equal opportunity employer. We require the right to work in the United States and do not sponsor visas for this role.
`

export const POSTINGS: readonly PostingFixture[] = [
  {
    id: 'ai-faculty',
    title: 'Tenure-Track Faculty in Artificial Intelligence — Meridian State University',
    url: 'https://www.higheredjobs.com/faculty/details.cfm?JobCode=180000001',
    text: AI_FACULTY,
    expect: [
      { says: 'phd', essential: true, label: 'the PhD' },
      { says: 'artificial intelligence', essential: true, label: 'the AI/ML research record' },
      { says: 'funding', essential: true, label: 'external funding' },
      { says: 'teaching', essential: true, label: 'teaching' },
      { says: 'postdoctoral', essential: false, label: 'a postdoc' },
      { says: 'neurips', essential: false, label: 'top venues' },
      { says: 'mentoring', essential: false, label: 'mentoring' },
      { says: 'trustworthy', essential: false, label: 'trustworthy AI' },
    ],
  },
  {
    id: 'cs-faculty',
    title:
      'Tenure-Track Assistant Professor Positions in Computer Science — Larkspur Valley University',
    url: 'https://www.higheredjobs.com/faculty/details.cfm?JobCode=180000002',
    // Invented, modelled on the structure of a real posting (see the comment
    // on `CS_FACULTY`): expectations are numbered in a sentence and there is
    // no "Required:" heading anywhere. The job code is made up too, next to
    // `ai-faculty`'s, so the URL leads to no real vacancy.
    text: CS_FACULTY,
    expect: [
      { says: 'phd', essential: true, label: 'the doctorate' },
      { says: 'research', essential: true, label: 'publishing research' },
      { says: 'funding', essential: true, label: 'pursuing funding' },
      { says: 'teach', essential: true, label: 'teaching' },
      { says: 'mentor', essential: true, label: 'mentoring graduate students' },
    ],
  },
  {
    id: 'ml-engineer',
    title: 'Machine Learning Engineer, LLM Platform — Northwind Labs',
    url: 'https://boards.greenhouse.io/northwindlabs/jobs/4812',
    text: ML_ENGINEER,
    expect: [
      { says: 'python', essential: true, label: 'Python' },
      { says: 'pytorch', essential: true, label: 'PyTorch' },
      { says: 'distributed training', essential: true, label: 'distributed training' },
      { says: 'production', essential: true, label: 'production ML' },
      { says: 'fine-tuning', essential: false, label: 'LLM fine-tuning' },
      { says: 'kubernetes', essential: false, label: 'Kubernetes' },
      { says: 'publications', essential: false, label: 'publications' },
    ],
  },
]

/**
 * What the chain should say about each pairing, as bands rather than numbers.
 *
 * Numbers move between runs and between models; the claim that has to hold is
 * coarser and more important — the AI researcher is at least worth tailoring
 * for the AI post and the systems researcher is not strong for it. `notStrong`
 * and `atLeastTailoring` are the two assertions, and a pairing may carry both.
 */
export const EXPECTED_FIT: readonly {
  readonly person: 'priya' | 'amara'
  readonly posting: string
  readonly atLeastTailoring?: true
  readonly notStrong?: true
}[] = [
  { person: 'priya', posting: 'ai-faculty', atLeastTailoring: true },
  { person: 'amara', posting: 'ai-faculty', notStrong: true },
  { person: 'priya', posting: 'cs-faculty', notStrong: true },
  { person: 'priya', posting: 'ml-engineer', atLeastTailoring: true },
]
