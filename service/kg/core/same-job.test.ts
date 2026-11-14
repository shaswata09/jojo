import { describe, expect, it } from 'vitest'
import { findDuplicate } from './duplicates'
import { sameEmployerStrict, sameJob } from './same-job'

/** One Kansas State posting, as three boards listed it (CRA's is the real one). */
const cra = {
  org: 'KANSAS STATE UNIVERSITY',
  role: 'Assistant Professor',
  location: 'MANHATTAN, Kansas',
  url: 'https://careercenter.cra.org/job/assistant-professor-manhattan-kansas-2507',
}
const hej = {
  org: 'Kansas State University',
  role: 'Tenure-Track Assistant Professor--Computer Science (2 openings)',
  location: 'Manhattan, KS',
  url: 'https://www.higheredjobs.com/faculty/details.cfm?JobCode=179593001',
}
const academicCareers = {
  org: 'Kansas State University',
  role: 'Assistant Professor of Computer Science',
  location: 'Manhattan, Kansas',
  url: 'https://academiccareers.com/job/182999/assistant-professor-of-computer-science/',
}

describe('the same job on two boards', () => {
  it('is recognised by employer, role and place, however each board writes them', () => {
    expect(sameJob(cra, hej)).toBe('listing')
    expect(sameJob(hej, academicCareers)).toBe('listing')
    expect(sameJob(academicCareers, cra)).toBe('listing')
  })

  it('is recognised by its posting ID or address before anything else', () => {
    expect(
      sameJob({ org: 'Rice', postingId: 'R0012345' }, { org: 'Rice University', postingId: 'Req # R0012345' }),
    ).toBe('id')
    expect(sameJob({ url: cra.url }, { url: `${cra.url}?utm_source=email` })).toBe('url')
  })

  it('ignores a title that carries the employer and the city', () => {
    const titled = { org: 'Kansas State University', role: 'Assistant Professor KANSAS STATE UNIVERSITY MANHATTAN, Kansas', location: 'Manhattan, Kansas' }
    expect(sameJob(titled, hej)).toBe('listing')
  })
})

/** A different listing: its own URL, so only the listing rule can match. */
const other = (over: Record<string, string>) => ({ ...academicCareers, url: 'https://academiccareers.com/job/183000/other/', ...over })

describe('different jobs that look alike', () => {
  it('are kept apart when the subject differs', () => {
    const data = other({ role: 'Assistant Professor of Data Science' })
    expect(sameJob(academicCareers, data)).toBeNull()
  })

  it('are kept apart when the rank differs', () => {
    expect(sameJob(academicCareers, other({ role: 'Associate Professor of Computer Science' }))).toBeNull()
  })

  it('are kept apart when the campus differs', () => {
    expect(sameJob(academicCareers, other({ location: 'Salina, KS' }))).toBeNull()
  })

  it('are kept apart at two employers that share most of a name', () => {
    expect(sameEmployerStrict('University of Texas at Austin', 'University of Texas at Dallas')).toBe(false)
    expect(sameJob({ ...academicCareers, org: 'University of Texas at Austin' }, other({ org: 'University of Texas at Dallas' }))).toBeNull()
  })

  it('need a role to compare: an employer and a city are not a job', () => {
    expect(sameJob({ org: 'Kansas State University', location: 'Manhattan, KS' }, hej)).toBeNull()
  })
})

describe('one employer, spelled two ways', () => {
  it('matches one name inside the other, and initials', () => {
    expect(sameEmployerStrict('Kansas State University', 'Kansas State University, Manhattan')).toBe(true)
    expect(sameEmployerStrict('KSU', 'Kansas State University')).toBe(true)
    expect(sameEmployerStrict('The University of Tennessee', 'University of Tennessee')).toBe(true)
  })
})

describe('employers whose names share their words', () => {
  it('keeps apart names that hold the same words in another order', () => {
    expect(sameEmployerStrict('Texas A&M University', 'University of Texas')).toBe(false)
    expect(sameEmployerStrict('Miami University', 'University of Miami')).toBe(false)
    expect(sameEmployerStrict('Washington University in St. Louis', 'University of Washington')).toBe(false)
    const role = 'Assistant Professor of Economics'
    expect(sameJob({ org: 'Miami University', role }, { org: 'University of Miami', role })).toBeNull()
  })

  it('does not let a bare generic word stand for an employer', () => {
    expect(sameEmployerStrict('University', 'University of Miami')).toBe(false)
    // ...though a name is still itself.
    expect(sameEmployerStrict('The College', 'College')).toBe(true)
  })

  it('still matches a name that is the other with a campus after it', () => {
    expect(sameEmployerStrict('Rice', 'Rice University')).toBe(true)
    expect(sameEmployerStrict('Miami University', 'Miami University, Oxford')).toBe(true)
  })
})

describe('a posting ID on its own', () => {
  /*
   * Short requisition numbers collide across employers — 'JR100234' at Rice
   * and at Duke are two jobs. The ID decides only when something else about
   * the two says they are the same place.
   */
  it('does not join two employers that happen to share a number', () => {
    expect(sameJob({ org: 'Rice', role: 'x', postingId: 'JR100234' }, { org: 'Duke', role: 'y', postingId: 'JR100234' })).toBeNull()
    expect(sameJob({ postingId: 'R0012345' }, { postingId: 'R0012345' })).toBeNull()
  })

  it('decides when the employer or the site agrees', () => {
    expect(
      sameJob(
        { org: 'Miami University', role: 'x', postingId: 'JR1', url: 'https://jobs.example.edu/a' },
        { org: 'University of Miami', role: 'y', postingId: 'JR1', url: 'https://www.jobs.example.edu/b' },
      ),
    ).toBe('id')
    expect(sameJob({ org: 'Rice University', role: 'x', postingId: 'JR1' }, { org: 'Rice', role: 'y', postingId: 'JR1' })).toBe('id')
  })

  /*
   * A job board's host is every employer's host. Two requisitions numbered
   * R1023 on Greenhouse are at the two tenants the paths name, and two
   * jobs.ac.uk listings sharing a reference are at whichever universities
   * placed them — the board does not say, so the address proves nothing.
   */
  it('does not count a job board as the site both agree on', () => {
    const anthropic = {
      org: 'Anthropic',
      role: 'Research Engineer',
      url: 'https://boards.greenhouse.io/anthropic/jobs/4020305008',
      postingId: 'R1023',
    }
    const stripe = { org: 'Stripe', role: 'Data Scientist', url: 'https://boards.greenhouse.io/stripe/jobs/5550001', postingId: 'R1023' }
    expect(sameJob(anthropic, stripe)).toBeNull()
    expect(findDuplicate([{ id: 'a', ...anthropic }], stripe)).toBeUndefined()

    const leeds = {
      org: 'University of Leeds',
      role: 'Lecturer in Physics',
      url: 'https://www.jobs.ac.uk/job/DAB123/lecturer-in-physics',
      postingId: 'EAS1234',
    }
    const york = {
      org: 'University of York',
      role: 'Research Associate',
      url: 'https://www.jobs.ac.uk/job/DCX987/research-associate',
      postingId: 'EAS1234',
    }
    expect(sameJob(leeds, york)).toBeNull()
    expect(findDuplicate([{ id: 'b', ...leeds }], york)).toBeUndefined()
  })

  it('still counts one tenant of a board as one site', () => {
    expect(
      sameJob(
        { org: 'Mistral AI', role: 'x', postingId: 'R7', url: 'https://jobs.lever.co/mistral/abc-123' },
        { org: 'Mistral', role: 'y', postingId: 'R7', url: 'https://jobs.lever.co/mistral/def-456?lever-source=x' },
      ),
    ).toBe('id')
    // The employer field spelled two unrelated ways: only the tenant agrees.
    expect(
      sameJob(
        { org: 'Acme Robotics', role: 'x', postingId: 'R7', url: 'https://boards.greenhouse.io/acme/jobs/1' },
        { org: 'ACR', role: 'y', postingId: 'R7', url: 'https://boards.greenhouse.io/acme/jobs/2' },
      ),
    ).toBe('id')
  })
})

describe('a name that leads a longer one', () => {
  /*
   * A bare name before a longer one is the same employer only when what the
   * longer one adds is the kind of employer ('University', 'Inc') or a campus
   * after a comma. Any other word makes a different employer: a bank, a power
   * company, a publisher.
   */
  it('does not merge a name with a different employer that starts with it', () => {
    expect(sameEmployerStrict('Rice', 'Rice Bank')).toBe(false)
    expect(sameEmployerStrict('Duke', 'Duke Energy')).toBe(false)
    expect(sameEmployerStrict('Institute of Physics', 'Institute of Physics Publishing')).toBe(false)
    expect(sameEmployerStrict('Rice University', 'Rice Bank')).toBe(false)
    const role = 'Data Scientist'
    expect(sameJob({ org: 'Rice', role }, { org: 'Rice Bank', role })).toBeNull()
  })

  it('merges the kind of employer and a campus after a comma', () => {
    expect(sameEmployerStrict('Rice', 'Rice University')).toBe(true)
    expect(sameEmployerStrict('Rice', 'Rice University, Houston')).toBe(true)
    expect(sameEmployerStrict('Stripe', 'Stripe, Inc.')).toBe(true)
    expect(sameEmployerStrict('Stripe', 'Stripe Inc')).toBe(true)
    expect(sameEmployerStrict('Kansas State University', 'Kansas State University, Manhattan')).toBe(true)
  })
})
