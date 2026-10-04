import { describe, expect, it } from 'vitest'
import type { Application } from '@jojo/service/core/model'
import {
  appliedDate,
  folderNames,
  packEntries,
  packFileName,
  REFEREE_COLUMNS,
  refereeTable,
  sheetFileName,
} from './referee-pack'

const app = (over: Partial<Application> = {}): Application =>
  ({
    id: 'application:1',
    org: 'Rice University',
    role: 'Assistant Professor of Statistics',
    note: '',
    roleTag: 'Faculty',
    stage: 'submitted',
    lastAction: '',
    daysAgo: 0,
    ...over,
  }) as Application

describe('refereeTable', () => {
  it('has one header per column, in column order', () => {
    const t = refereeTable([])
    expect(t.headers).toEqual(REFEREE_COLUMNS.map((c) => c.header))
    expect(t.widths).toHaveLength(REFEREE_COLUMNS.length)
  })

  it('reads one row per application, with the brief and the materials', () => {
    const t = refereeTable([
      {
        application: app({ url: 'https://jobs.rice.edu/42', location: 'Houston', appliedOn: '2026-09-01' }),
        brief: { applicationId: 'application:1', highlights: ['teaching', 'NSF CAREER'], note: 'Due 15 Oct' },
        materials: ['CV.pdf', 'Research statement.txt'],
      },
    ])
    expect(t.rows[0]).toEqual([
      'Rice University',
      'Assistant Professor of Statistics',
      { text: 'https://jobs.rice.edu/42', link: 'https://jobs.rice.edu/42' },
      'Houston',
      '2026-09-01',
      'Submitted',
      '• teaching\n• NSF CAREER',
      'Due 15 Oct',
      'CV.pdf\nResearch statement.txt',
    ])
  })

  it('leaves a row blank where nothing is known, rather than guessing', () => {
    const [row] = refereeTable([{ application: app(), materials: [] }]).rows
    expect(row?.slice(2, 5)).toEqual(['', '', ''])
    expect(row?.slice(6)).toEqual(['', '', ''])
  })

  it('keeps an unsafe posting URL as text, not a link', () => {
    const [row] = refereeTable([{ application: app({ url: 'javascript:alert(1)' }), materials: [] }]).rows
    expect(row?.[2]).toBe('javascript:alert(1)')
  })
})

describe('appliedDate', () => {
  it('prefers the applied date and falls back to the submitted one', () => {
    expect(appliedDate(app({ appliedOn: '2026-09-01', submittedOn: '2026-08-30' }))).toBe('2026-09-01')
    expect(appliedDate(app({ submittedOn: '2026-08-30' }))).toBe('2026-08-30')
    expect(appliedDate(app())).toBe('')
  })
})

describe('folders and entries', () => {
  it('names a folder for the job, and keeps two identical jobs apart', () => {
    expect(folderNames([app(), app({ id: 'application:2' }), app({ org: 'Yale', role: 'Lecturer' })])).toEqual([
      'Rice University — Assistant Professor of Statistics',
      'Rice University — Assistant Professor of Statistics (2)',
      'Yale — Lecturer',
    ])
  })

  it('never lets a job title make a path', () => {
    const [folder] = folderNames([app({ org: '../etc', role: 'a/b\\c' })])
    expect(folder).not.toMatch(/[/\\]/)
  })

  it('lays documents out per folder, unique within each, and lists what it wrote', () => {
    const bytes = new Uint8Array([1])
    const { entries, listed } = packEntries([
      { folder: 'Rice', documents: [{ name: 'CV.pdf', bytes }, { name: 'CV.pdf', bytes }] },
      { folder: 'Yale', documents: [{ name: 'CV.pdf', bytes, modified: 5 }] },
    ])
    expect(entries.map((e) => e.name)).toEqual([
      'materials/Rice/CV.pdf',
      'materials/Rice/CV (2).pdf',
      'materials/Yale/CV.pdf',
    ])
    expect(entries[2]?.modified).toBe(5)
    expect(listed).toEqual([['CV.pdf', 'CV (2).pdf'], ['CV.pdf']])
  })
})

describe('file names', () => {
  it('names the sheet and the pack for the person and the day', () => {
    expect(sheetFileName('Ngozi Okafor', '2026-10-03', 'xlsx')).toBe('Ngozi Okafor — applications 2026-10-03.xlsx')
    expect(sheetFileName('Ngozi Okafor', '2026-10-03', 'csv')).toBe('Ngozi Okafor — applications 2026-10-03.csv')
    expect(packFileName('Ngozi Okafor', '2026-10-03')).toBe('Ngozi Okafor — applications 2026-10-03.zip')
  })

  it('cannot be turned into a path by the person’s name', () => {
    expect(packFileName('a/b', '2026-10-03')).not.toContain('/')
  })
})
