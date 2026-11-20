/**
 * The marks on a tailored document, measured against the source.
 *
 * The fixture is the shape of the real failure: a CV read out of a PDF (its
 * lines wrapped where the PDF wrapped them), and replies in the shapes
 * MiniMax-M2.1 actually produced for it on 2026-11-19 — unchanged lines bolded
 * as new, changed words left plain, publications moved up without a mark.
 */

import { describe, expect, it } from 'vitest'
import { checkMarks, wordKey } from './mark-check'
import { parseMarks, stripMarks } from './marks'

const SOURCE = [
  'Lonardo Jenson',
  'PhD Candidate, Computer Science · University of Texas at Dallas · lonardo.jenson@example.edu',
  'R E S E A R C H I N T E R E S T S',
  'Machine learning on graphs, agentic systems that plan with tools, and trustworthy AI for security. I build',
  'methods that are measured on real systems and released as open code.',
  'E D U C A T I O N',
  'Ph.D., Computer Science',
  '2021 – 2026 (expected)',
  'University of Texas at Dallas · Advisor: Prof. S. Nakamura',
  'M.S., Computer Science',
  'University of Houston',
  'S E L E C T E D P U B L I C A T I O N S',
  'L. Jenson, M. Okafor, S. Nakamura. Local-first retrieval for private assistants. ICLR, 2025.',
  'K. Ito, L. Jenson. Measuring agent reliability under tool failure. ACL Findings, 2024.',
  'L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025.',
  'T E A C H I N G',
  'Instructor of record, CS 4375 Machine Learning (Summer 2025) · 62 students · evaluation 4.8 / 5',
  'Teaching assistant, CS 6375 Machine Learning (2022 – 2024)',
  'E X P E R I E N C E',
  'Built an evaluation harness for tool-using agents; cut regression triage time by half.',
].join('\n')

/** Which words a body marks, and how. */
function marksOf(body: string): { bold: string[]; italic: string[]; underline: string[] } {
  const out = { bold: [] as string[], italic: [] as string[], underline: [] as string[] }
  for (const block of parseMarks(body)) {
    if (block.kind === 'blank') continue
    for (const run of block.runs) {
      const text = run.text.trim()
      if (text === '') continue
      if (run.bold) out.bold.push(text)
      else if (run.italic) out.italic.push(text)
      else if (run.underline) out.underline.push(text)
    }
  }
  return out
}

describe('marks the model drew on unchanged text', () => {
  it('unmarks lines that are the source word for word, however the model marked them', () => {
    // Take 3: four lines bolded as "new or rewritten", none of them changed.
    const reply = [
      '**Ph.D., Computer Science**',
      '2021 – 2026 (expected)',
      '**Instructor of record, CS 4375 Machine Learning (Summer 2025) · 62 students · evaluation 4.8 / 5**',
      '**Teaching assistant, CS 6375 Machine Learning (2022 – 2024)**',
    ].join('\n')
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body)).toEqual({ bold: [], italic: [], underline: [] })
    expect(out.unmarked).toBe(3)
    expect(out.marked).toBe(0)
  })

  it('unmarks one word bolded inside a paragraph that did not change', () => {
    // Take 3 again: "security" bolded inside the research interests, which the
    // model returned as written — but on one line, where the PDF had two.
    const reply =
      'Machine learning on graphs, agentic systems that plan with tools, and trustworthy AI for **security**. I build methods that are measured on real systems and released as open code.'
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).bold).toEqual([])
    expect(out.unmarked).toBe(1)
  })
})

describe('changes the model did not mark', () => {
  it('marks a new sentence the model left plain', () => {
    const reply = [
      'Lonardo Jenson',
      'Machine learning researcher focused on graph learning and agentic AI, with a record in top venues.',
      'Ph.D., Computer Science',
    ].join('\n')
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).bold).toEqual([
      'Machine learning researcher focused on graph learning and agentic AI, with a record in top venues',
    ])
    expect(out.marked).toBe(1)
  })

  it('marks only the new words in a line that keeps a run of the original', () => {
    const reply =
      'Built an evaluation harness for tool-using agents used across three research groups; cut regression triage time by half.'
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).bold).toEqual(['used across three research groups'])
  })

  it('keeps the model’s italic for words it called reworded', () => {
    const reply =
      'Built an evaluation harness for tool-using agents; _halved the time spent triaging regressions._'
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).italic).toEqual(['halved the time spent triaging regressions'])
    expect(marksOf(out.body).bold).toEqual([])
  })

  it('marks an invented claim the model presented as original', () => {
    // The dangerous direction: an unmarked line that is not in the CV.
    const reply = [
      'L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025.',
      'L. Jenson. Secure agents at scale. ICML, 2025.',
    ].join('\n')
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).bold).toEqual(['L. Jenson. Secure agents at scale. ICML, 2025'])
  })
})

describe('moved up', () => {
  it('underlines a publication moved above the ones it followed, and not the ones it passed', () => {
    const reply = [
      '__L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025.__',
      'L. Jenson, M. Okafor, S. Nakamura. Local-first retrieval for private assistants. ICLR, 2025.',
      'K. Ito, L. Jenson. Measuring agent reliability under tool failure. ACL Findings, 2024.',
    ].join('\n')
    const out = checkMarks(reply, SOURCE)
    expect(marksOf(out.body).underline).toEqual([
      'L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025',
    ])
    expect(out.moved).toBe(1)
  })

  it('underlines a move the model forgot to mark', () => {
    const reply = [
      'L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025.',
      'L. Jenson, M. Okafor, S. Nakamura. Local-first retrieval for private assistants. ICLR, 2025.',
    ].join('\n')
    expect(marksOf(checkMarks(reply, SOURCE).body).underline).toHaveLength(1)
  })

  it('does not underline a line the model claimed it moved but left in place', () => {
    const reply = [
      'Ph.D., Computer Science',
      '__2021 – 2026 (expected)__',
      '__University of Texas at Dallas · Advisor: Prof. S. Nakamura__',
    ].join('\n')
    expect(marksOf(checkMarks(reply, SOURCE).body).underline).toEqual([])
  })

  it('does not read a repeated phrase as a move', () => {
    // "University of Texas at Dallas" is in the header AND under the Ph.D.
    const reply = [
      'PhD Candidate, Computer Science · University of Texas at Dallas · lonardo.jenson@example.edu',
      'Ph.D., Computer Science',
      'University of Texas at Dallas · Advisor: Prof. S. Nakamura',
    ].join('\n')
    expect(marksOf(checkMarks(reply, SOURCE).body)).toEqual({ bold: [], italic: [], underline: [] })
  })
})

describe('what it leaves alone', () => {
  it('reads a letter-spaced heading spaced differently as unchanged', () => {
    // MarkItDown gave "S E L E C T E D P U B L I C AT I O N S"; MiniMax re-spaced it.
    const source = `${SOURCE}\nS E L E C T E D   P U B L I C AT I O N S`
    const out = checkMarks('S E L E C T E D   P U B L I C A T I O N S', source)
    expect(marksOf(out.body)).toEqual({ bold: [], italic: [], underline: [] })
  })

  it('marks a publication title the model altered and did not mark', () => {
    // Run 1 on 2026-11-20: "tool-calling" became "tool-using" in a real paper's
    // title, unmarked. Its letters exist elsewhere in the CV ("tool-using
    // agents" under Experience), so the spelling fallback must not hide it.
    const out = checkMarks(
      'L. Jenson, S. Nakamura. Graph inference with tool-using agents. NeurIPS, 2025.',
      `${SOURCE}\nBuilt a harness for tool-using agents.`,
    )
    expect(marksOf(out.body).bold).toEqual(['tool-using'])
  })

  it('leaves headings and the closing "Unchanged:" note as the model wrote them', () => {
    const reply = '## **Research interests**\nUnchanged: Education, Teaching'
    const out = checkMarks(reply, SOURCE)
    expect(out.body).toBe(reply)
  })

  it('keeps a bullet outside the mark', () => {
    const out = checkMarks('- Mentored three undergraduate researchers on graph learning.', SOURCE)
    expect(out.body).toBe('- **Mentored three undergraduate researchers on graph learning**.')
  })

  it('never changes a character of the text, only where the marks sit', () => {
    const replies = [
      '**Ph.D., Computer Science** and _snake_case_ handles lonardo_jenson@example.edu',
      'Mitra, S.*, Rao, P. — OSDI 2024 **(2024)** C++ and *Rust*,',
      '- **text** retrieval systems\n\n## Heading\nUnchanged: Teaching',
      'Built an evaluation harness for tool-using agents; _(reworded)_ cut regression triage time by half.',
      '__L. Jenson, S. Nakamura. Graph inference with tool-calling agents. NeurIPS, 2025.__',
    ]
    for (const reply of replies) {
      expect(stripMarks(checkMarks(reply, SOURCE).body)).toBe(stripMarks(reply))
    }
  })
})

describe('the comparison key', () => {
  it('folds case, edge punctuation and the dashes and quotes a PDF and a model disagree on', () => {
    expect(wordKey('2025.')).toBe('2025')
    expect(wordKey('(NeurIPS,')).toBe('neurips')
    expect(wordKey('Ph.D.,')).toBe('ph.d')
    expect(wordKey('tool–using')).toBe('tool-using')
    expect(wordKey('person’s')).toBe("person's")
    expect(wordKey('·')).toBe('')
  })
})
