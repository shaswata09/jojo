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
 *   - `utk-cs`: a REAL posting (University of Tennessee, Knoxville, fetched
 *     2026-09-12), which lists expectations without "Required:" headings and
 *     says in prose that AI/ML-only candidates will not be considered. A test
 *     of the reader's judgement about what is essential, and a posting no
 *     AI-only candidate should come out of as strong.
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

const UTK_CS = `Description:
The University of Tennessee, Knoxville
 (UTK) seeks exceptional candidates for two tenure-track faculty positions in the Min H. Kao Department of Electrical Engineering and Computer Science (
EECS
) at the rank of Assistant Professor. Primary consideration will be given to candidates in the areas of security and privacy, computer graphics (including VR/AR), programming languages, robotics, or human-computer interaction. Strong candidates from other areas of research will also be considered. Candidates whose only research area is AI/ML will not be considered for this search.
The successful candidate will be expected to (1) conduct and publish scholarly research; (2) pursue funding to support an active research agenda; (3) teach undergraduate and graduate courses in computer science and related areas; (4) mentor graduate students; and (5) participate in departmental service.
Information about the University, College, Department, and Knoxville
UTK
 is the state's flagship campus and leading research institution with a strong partnership with nearby Oak Ridge National Laboratory (ORNL), where many UTK faculty have ongoing joint positions and/or joint research projects.
The Tickle College of Engineering
 (TCE) is in the midst of an unprecedented period of growth and success, including adding over 30 new faculty at all levels to the college over 4 years as part of ambitious hiring campaigns led by Chancellor Donde Plowman and Dean Matthew Mench. The college has set records in research expenditures, enrollment, incoming student GPA, intellectual property development, and USNWR rank in the past three years. Key partnerships with Oak Ridge National Lab (ORNL) through the University of Tennessee Oak Ridge Innovation Institute (UTORII) and Consolidated Nuclear Security (CNS) that manages the Y-12 National Security Complex have created an expanded opportunity space for faculty and students in the region. New facilities include the state-of-the art Zeanah Engineering Complex, the University of Tennessee Manufacturing and Design Enterprise (TN-MADE) facility, and the Innovation South building that houses UTK's Fibers and Composites Manufacturing Facility (FCMF), a National Prototype Research Center (NSPC) as part of a partnership with CNS Y-12 under construction, and new facilities for the Biomedical Engineering department and a quantum foundry in planning stages.
TCE currently has 213 tenure/tenure track and over 80 non-tenure track faculty in its nine academic departments and offers 11 undergraduate, 16 MS, and 15 PhD/DE degree programs. Affiliated with TCE and located in Tullahoma, Tennessee, the UT Space Institute is a hub of aerospace and defense research. The college is also home to eight research centers and three interdisciplinary institutes. With approximately 4,800 undergraduate and 1,500 graduate students, the college sits 28th among public universities in the most recent U.S. News and World Report graduate rankings. Faculty in the college have won 33 early career awards (NSF, DOE, DARPA, AFOSR, AHA, and Sloan) since 2016. In FY25, the college had annual research expenditures of $113.9M.
EECS
 at UTK has 50 full-time T/TT faculty members, three members of the National Academy of Engineering Fellows, 15 IEEE Fellows, 15 NSF/DOE CAREER awardees, and 19 ranked in World's Top 2% Scientists as compiled by Stanford. The department has a growing enrollment of more than 1000 undergraduate and more than 450 graduate students across the three majors of Electrical Engineering, Computer Engineering, and Computer Science. In addition, the department offers undergraduate minors in computer science, cybersecurity, datacenter technology and management, and machine learning. Successful faculty candidates will be expected to contribute to the continued growth and excellence of EECS.
The city of Knoxville is a hidden gem with an elegant and walkable downtown, rich and varied nightlife, vibrant neighborhoods, eclectic restaurants, and amazing access to outdoor activities of all kinds as well as exciting cultural events throughout the year. UTK is in Knoxville, Tennessee, within an easy driving distance to Nashville, Atlanta, Asheville, and the Great Smoky Mountains National Park. From Knoxville's TYS Airport, Knoxville has nonstop flights to 22 major airports in the US, including direct flights to cities such as DC, NYC, Atlanta, Boston, Charlotte, Chicago, Dallas, Denver, Detroit, Houston, Las Vegas, Miami, Orlando, Philadelphia, Phoenix.
In addition, Knoxville and the surrounding areas boast great K-12 schools and one of the most highly educated populations in the entire US. With one of the lowest costs of living in the country, Knoxville was recently recognized in U.S. News and World Report as the 29th best place to live in the U.S. In 2024, US News ranked the State of Tennessee as #5 in fiscal stability, #12 in economy, and #21 in infrastructure.
Qualifications:
Applicants must hold a Ph. D. in Computer Science, or a closely related field, at the time of appointment.
The candidate is expected to show potential to establish an independent research program, secure external funding, and contribute to interdisciplinary collaboration. The candidate is also expected to show effective, high-quality teaching skills, and the ability to effectively mentor undergraduate and graduate students.
Application Instructions:
For full consideration, applications should be received by October 15, 2026. Review of applications will continue until the position is filled. Please submit the following items via Interfolio to complete your application:
Cover Letter
Curriculum Vitae
Research Statement
Teaching Statement
Names and Contact Information of Three References
For questions, please email the Search Committee Chair, Dr. Scott Ruoti (
ruoti@utk.edu
). 
 The University of Tennessee is an EEO/AA/Title VI/Title IX/Section 504/ADA/ADEA institution in the provision of its education and employment programs and services. All qualified applicants will receive equal consideration for employment without regard to, and will not be discriminated against on the basis of, race, color, national origin, religion, sex, pregnancy, marital status, sexual orientation, gender identity, age, physical or mental disability, or covered veteran status. 
Inquiries and charges of violation of Title VI (race, color, national origin), Title IX (sex), Section 504 (disability), ADA (disability), ADEA (age), sexual orientation, or veteran status should be directed to the (EEO). Requests for accommodation of a disability should be directed to the ADA Coordinator at the EEO office.
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
    id: 'utk-cs',
    title:
      'Tenure-Track Assistant Professor Positions in Computer Science — University of Tennessee, Knoxville',
    url: 'https://www.higheredjobs.com/faculty/details.cfm?JobCode=179545452',
    // Fetched 2026-09-12 and trimmed to the posting itself. Real prose, real
    // structure: expectations are numbered in a sentence and there is no
    // "Required:" heading anywhere.
    text: UTK_CS,
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
  { person: 'priya', posting: 'utk-cs', notStrong: true },
  { person: 'priya', posting: 'ml-engineer', atLeastTailoring: true },
]
