/**
 * L1 — what jojo is, in terms of maturity, said once for every surface.
 *
 * ## Why this is a module and not a paragraph typed into each app
 *
 * The same statement has to appear on the web app, on the phone, in the README
 * and in `NOTICE`. Four copies of a claim about liability is four chances for
 * them to disagree, and the one that disagrees is the one somebody quotes back.
 * The two apps render this; the two files are checked against it by
 * `status.test.ts`, which is the closest a text file can get to being compiled.
 *
 * ## What this does NOT do, and cannot
 *
 * It does not restrict anything. jojo is Apache-2.0, and that licence GRANTS the
 * right to use, modify and redistribute — including commercially. A notice
 * cannot take back a grant the licence makes, and pretending otherwise would be
 * worse than saying nothing: a reader who believed it would be misled about
 * their actual rights.
 *
 * What a notice CAN do is tell somebody what they are picking up. That this is
 * research code rather than a product, that it is unfinished and changing, that
 * nobody is operating it for them, and that the responsibility for what they do
 * with it is theirs. All of which is true, none of which contradicts the
 * licence, and all of which a person deserves to know before they trust a job
 * search to it.
 */

/** The one-line version, for a footer or a badge. */
export const STATUS_HEADLINE = 'Research preview — a work in progress, not a finished product.'

/** The short version, for a page subtitle or a README callout. */
export const STATUS_SUMMARY =
  'jojo is an ongoing research and development project, published so the approach can be ' +
  'examined and tested. It is not a finished product, it is not supported, and it should not be ' +
  'relied on for anything that matters to you without your own backups and your own judgement.'

/** One point of the notice: a short label and the sentence that explains it. */
export type StatusPoint = { label: string; body: string }

/**
 * The full statement, as the apps render it.
 *
 * Each point is something a reader can act on rather than a disclaimer for its
 * own sake — what to expect, what to check, and where the responsibility sits.
 */
export const STATUS_POINTS: readonly StatusPoint[] = [
  {
    label: 'It is unfinished, and it changes',
    body:
      'Features are here to be tried and measured, not because they are settled. Behaviour, ' +
      'storage formats and screens can all change between versions, and a change may lose ' +
      'records written by an earlier one. Export a backup before you upgrade — Settings has the ' +
      'button, and this is the reason it is there.',
  },
  {
    label: 'For research and testing',
    body:
      'It is built to explore what a local-first, agentic job tracker can do. Treat what it ' +
      'produces — a draft, a match, a suggested reminder — as a starting point to check, not an ' +
      'answer to act on. Nothing it writes has been reviewed by anybody.',
  },
  {
    label: 'Copying and distribution',
    body:
      'The Apache-2.0 licence lets you use, change and redistribute this, and that grant stands. ' +
      'What we ask is that you do not pass it on as a finished or supported product, and that ' +
      'anything you build on it carries the same notice — because the person downstream deserves ' +
      'to know it is research code as much as you did.',
  },
  {
    label: 'No warranty, and no liability',
    body:
      'Provided “as is”, with no warranty of any kind and no liability for any loss arising from ' +
      'its use or distribution — see sections 7 and 8 of the licence. That covers lost or ' +
      'corrupted records, a missed deadline, and anything a connected model gets wrong.',
  },
  {
    label: 'The services you connect are yours',
    body:
      'jojo ships no API key and bundles no third-party code. Every model, reader and provider is ' +
      'one you configure with your own credentials, which makes you the party to that agreement ' +
      'and responsible for what you send. jojo is not a party to it and cannot answer for it.',
  },
] as const
