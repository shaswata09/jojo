import { STAGE_LABEL, type Application, type ISODate, type RefereeBrief } from '@jojo/service/core/model'
import { type ArchiveEntry, uniqueEntryNames } from '@/lib/document-archive'
import { type Cell, safeLink, type Table } from '@/lib/spreadsheet'

/**
 * What a recommender is sent: every application they are writing for, with
 * the posting, the date, and what you want them to highlight — as a sheet,
 * optionally zipped with the materials you sent that employer.
 *
 * Pure. `RefereePackDialog` gathers the records and the bytes, this decides
 * what the rows say and where every file goes, and `spreadsheet.ts` encodes
 * the sheet.
 */

/** The columns, in the order a recommender reads them: who, what, where, when, then what to say. */
export const REFEREE_COLUMNS = [
  { header: 'Employer', width: 24 },
  { header: 'Position', width: 30 },
  { header: 'Posting link', width: 34 },
  { header: 'Location', width: 16 },
  { header: 'Applied on', width: 12 },
  { header: 'Stage', width: 14 },
  { header: 'Highlight', width: 30 },
  { header: 'Notes for you', width: 44 },
  { header: 'Materials sent', width: 30 },
] as const

/** One application on its way into the sheet. */
export type PackItem = {
  application: Application
  brief?: RefereeBrief | undefined
  /** The names of the materials sent, exactly as they appear in the ZIP. */
  materials: readonly string[]
}

/**
 * The date the application went in: `appliedOn`, which the stage move to
 * Submitted records, or `submittedOn`, which older and imported records carry
 * instead. Blank rather than guessed when neither is set.
 */
export const appliedDate = (application: Application) =>
  application.appliedOn ?? application.submittedOn ?? ''

/** One per line, with a bullet, so a cell of several reads as a list in Excel. */
const lines = (items: readonly string[] | undefined) => (items ?? []).map((item) => `• ${item}`).join('\n')

/**
 * The posting as a cell: a link when the URL is one a spreadsheet may follow,
 * plain text otherwise, blank when there is none. See `safeLink`.
 */
function postingCell(url: string | undefined): Cell {
  if (url === undefined || url.trim() === '') return ''
  const link = safeLink(url)
  return link === null ? url.trim() : { text: link, link }
}

export function refereeTable(items: readonly PackItem[]): Table {
  return {
    headers: REFEREE_COLUMNS.map((c) => c.header),
    widths: REFEREE_COLUMNS.map((c) => c.width),
    rows: items.map(({ application: a, brief, materials }) => [
      a.org,
      a.role,
      postingCell(a.url),
      a.location ?? '',
      appliedDate(a),
      STAGE_LABEL[a.stage],
      lines(brief?.highlights),
      brief?.note ?? '',
      materials.join('\n'),
    ]),
  }
}

/**
 * Where an application's materials go in the ZIP: `materials/<Employer — Position>/`.
 *
 * Named for the job rather than numbered, because the recommender opens the
 * folder looking for "the Rice one". Two applications to one employer for the
 * same title — it happens, two departments — are kept apart by
 * `uniqueEntryNames`, the same rule that keeps two `CV.pdf`s apart inside one.
 */
export function folderNames(applications: readonly Application[]): string[] {
  return uniqueEntryNames(applications.map((a) => `${a.org} — ${a.role}`))
}

/** One document for one application's folder. */
export type PackDocument = { name: string; bytes: Uint8Array; modified?: number }

/**
 * Every document laid out for the ZIP, plus the names each application's row
 * should list.
 *
 * Names are made safe and unique per folder before they are listed, so the
 * "Materials sent" cell names exactly the files the recommender will find.
 */
export function packEntries(
  groups: readonly { folder: string; documents: readonly PackDocument[] }[],
): { entries: ArchiveEntry[]; listed: string[][] } {
  const entries: ArchiveEntry[] = []
  const listed: string[][] = []
  for (const group of groups) {
    const names = uniqueEntryNames(group.documents.map((d) => d.name))
    listed.push(names)
    group.documents.forEach((document, i) => {
      entries.push({
        name: `materials/${group.folder}/${names[i] ?? document.name}`,
        bytes: document.bytes,
        ...(document.modified === undefined ? {} : { modified: document.modified }),
      })
    })
  }
  return { entries, listed }
}

/** `Ngozi Okafor — applications 2026-10-03.xlsx`. The name makes the file findable in their inbox. */
export const sheetFileName = (person: string, day: ISODate, ext: 'xlsx' | 'csv') =>
  `${uniqueEntryNames([`${person} — applications ${day}`])[0]}.${ext}`

/** `Ngozi Okafor — applications 2026-10-03.zip`. */
export const packFileName = (person: string, day: ISODate) =>
  `${uniqueEntryNames([`${person} — applications ${day}`])[0]}.zip`
