import { useMemo, useState } from 'react'
import { Check, Download, ExternalLink } from 'lucide-react'
import { stripMarks } from '@jojo/service/core/marks'
import {
  CONTACT_ROLE_LABEL,
  MAX_BRIEF_NOTE_TEXT,
  STAGE_LABEL,
  type Application,
  type ContactRole,
  type Person,
  type RefereeBrief,
} from '@jojo/service/core/model'
import { dayOf } from '@jojo/service/core/project'
import {
  briefFor,
  highlightsText,
  normaliseBriefs,
  parseHighlights,
} from '@jojo/service/core/referee-brief'
import { TAILORABLE_BUCKET } from '@jojo/service/core/tailoring'
import { useApplications } from '@jojo/service/react/use-applications'
import { useVault } from '@jojo/service/react/use-vault'
import { Field, TextareaField } from '@/components/common/Field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { contentModal } from '@/components/ui/dialog-width'
import { buildArchive } from '@/lib/document-archive'
import {
  appliedDate,
  folderNames,
  type PackDocument,
  packEntries,
  packFileName,
  refereeTable,
  sheetFileName,
} from '@/lib/referee-pack'
import { reportError } from '@/lib/report-error'
import { saveFile } from '@/lib/save-file'
import { CSV_MIME, toCsv, toXlsx, XLSX_MIME } from '@/lib/spreadsheet'
import { useToast } from '@/lib/toast-context'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { cn } from '@/lib/utils'

/**
 * The list a recommender is sent: the applications they are writing for, with
 * what you want each letter to highlight.
 *
 * WHY A DIALOG ON THE PERSON. The question this answers is "what do I send
 * Ngozi", and Ngozi is the record it starts from — a referee is filed under
 * every job they write for (see `PeopleTool`), so the list already exists; what
 * was missing was a way to say something about each entry and hand it over.
 *
 * WHAT IS KEPT. The highlights and the note per application are saved on the
 * person (`RefereeBrief`), so the next time the list goes out — a new job added,
 * a deadline moved — nothing has to be retyped. Which rows are ticked and the
 * format are choices about one download, and are not kept.
 *
 * WHAT IS SENT. A sheet (Excel by default; CSV for anyone whose tool is not a
 * spreadsheet — see `spreadsheet.ts` for why Excel is the safer default) and,
 * unless switched off, the materials filed under each application: documents in
 * the Vault's Applications drawer — the same set tailoring treats as yours —
 * and snippets, as plain text. Postings and reading are not "materials" and
 * stay out.
 */

type Draft = { include: boolean; highlights: string; note: string }

type Format = 'xlsx' | 'csv'

const draftFor = (
  application: Application,
  brief: RefereeBrief | undefined,
  role: ContactRole | undefined,
): Draft => ({
  // A closed application is history, not something to write for, and a job
  // where this person is your point of contact is not one they are writing
  // for. Both are still listed, so they can be ticked back on, but neither is
  // sent by default. No role at all — every filing from before roles existed —
  // counts as writing for it, which is what being named on a job meant then.
  include: application.stage !== 'closed' && role !== 'contact',
  highlights: highlightsText(brief?.highlights),
  note: brief?.note ?? '',
})

/** The drafts as briefs, cleaned the same way the tool will clean them. */
const toBriefs = (drafts: Record<string, Draft>, filed: ReadonlySet<string>) =>
  normaliseBriefs(
    Object.entries(drafts).map(([applicationId, d]) => ({
      applicationId,
      highlights: parseHighlights(d.highlights),
      note: d.note,
    })),
    filed,
  )

export function RefereePackDialog({
  person,
  open,
  onOpenChange,
}: {
  person: Person
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { byId } = useApplications()
  const { forApplication, updatePerson } = useVault()
  const blobs = useVaultBlobs()
  const { toast } = useToast()

  const applications = useMemo(
    () => person.applicationIds.flatMap((id) => byId.get(id) ?? []),
    [person.applicationIds, byId],
  )
  const filed = useMemo(() => new Set(applications.map((a) => a.id)), [applications])

  /*
   * Seeded once, from the person as the dialog opens. `PeopleTool` mounts this
   * per opening, so a lazy initial state is the whole story — and a brief saved
   * from another tab while it is open does not wipe what is being typed here.
   */
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      applications.map((a) => [a.id, draftFor(a, briefFor(person.briefs, a.id), person.roles?.[a.id])]),
    ),
  )
  const [format, setFormat] = useState<Format>('xlsx')
  const [withMaterials, setWithMaterials] = useState(true)
  const [busy, setBusy] = useState(false)

  /** What would be sent for one application: its documents and snippets. */
  const materialsOf = (id: string) => {
    const filedHere = forApplication(id)
    return {
      files: filedHere.files.filter((f) => f.bucket === TAILORABLE_BUCKET),
      snippets: filedHere.snippets,
    }
  }

  const chosen = applications.filter((a) => drafts[a.id]?.include)

  /** Saved only when it changed, so opening and closing leaves no undo step behind. */
  const saveBriefs = () => {
    const next = toBriefs(drafts, filed)
    const before = normaliseBriefs(person.briefs ?? [], filed)
    if (JSON.stringify(next) !== JSON.stringify(before)) updatePerson(person.id, { briefs: next })
  }

  const set = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => {
      const current = prev[id]
      return current === undefined ? prev : { ...prev, [id]: { ...current, ...patch } }
    })

  const download = async () => {
    setBusy(true)
    try {
      saveBriefs()
      const day = dayOf(new Date().toISOString())
      const briefs = toBriefs(drafts, filed)

      // Every document's bytes, read before anything is built: a document this
      // browser no longer holds is left out and counted, not allowed to fail
      // the whole download.
      let unreadable = 0
      const groups: { folder: string; documents: PackDocument[] }[] = []
      const folders = folderNames(chosen)
      for (const [i, application] of chosen.entries()) {
        const { files, snippets } = materialsOf(application.id)
        const documents: PackDocument[] = []
        if (withMaterials) {
          for (const file of files) {
            const stored = await blobs.get(file.id)
            if (stored === null) {
              unreadable += 1
              continue
            }
            documents.push({
              name: file.name,
              bytes: new Uint8Array(await stored.arrayBuffer()),
              modified: stored.lastModified,
            })
          }
          for (const snippet of snippets) {
            documents.push({
              name: `${snippet.title}.txt`,
              bytes: new TextEncoder().encode(stripMarks(snippet.body)),
            })
          }
        } else {
          // Listed by name only, so the sheet still says what each employer got.
          for (const file of files) documents.push({ name: file.name, bytes: new Uint8Array() })
          for (const snippet of snippets) documents.push({ name: `${snippet.title}.txt`, bytes: new Uint8Array() })
        }
        groups.push({ folder: folders[i] ?? application.org, documents })
      }

      const { entries, listed } = packEntries(groups)
      const table = refereeTable(
        chosen.map((application, i) => ({
          application,
          brief: briefFor(briefs, application.id),
          materials: listed[i] ?? [],
        })),
      )
      const sheetName = sheetFileName(person.name, day, format)
      const sheet = format === 'xlsx' ? toXlsx(table, 'Applications') : new TextEncoder().encode(toCsv(table))

      if (withMaterials && entries.length > 0) {
        const zipName = packFileName(person.name, day)
        saveFile(buildArchive([{ name: sheetName, bytes: sheet }, ...entries]), zipName, 'application/zip')
        toast({
          title: `List for ${person.name} saved`,
          description:
            unreadable === 0
              ? `${zipName}: the sheet and ${entries.length} document${entries.length === 1 ? '' : 's'}, in your downloads folder.`
              : `${zipName} is in your downloads folder, without ${unreadable} document${unreadable === 1 ? '' : 's'} this browser could no longer read.`,
          ...(unreadable === 0 ? {} : { tone: 'danger' as const }),
        })
      } else {
        saveFile(sheet, sheetName, format === 'xlsx' ? XLSX_MIME : CSV_MIME)
        toast({ title: `List for ${person.name} saved`, description: `${sheetName}, in your downloads folder.` })
      }
      onOpenChange(false)
    } catch (error) {
      reportError('backup', error)
      toast({
        title: 'Could not build the list',
        description: 'Nothing was downloaded. Your highlights and notes were kept.',
        tone: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  const documentCount = chosen.reduce((n, a) => {
    const m = materialsOf(a.id)
    return n + m.files.length + m.snippets.length
  }, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(contentModal, 'sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>Applications for {person.name}</DialogTitle>
          <DialogDescription>
            Tick the ones to send and say what you want each letter to highlight. Your highlights and
            notes are kept on {person.name} for next time.
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-4 flex max-h-[55vh] flex-col overflow-y-auto px-4">
          {applications.map((a) => {
            const d = drafts[a.id]
            if (d === undefined) return null
            const m = materialsOf(a.id)
            const count = m.files.length + m.snippets.length
            const date = appliedDate(a)
            const role = person.roles?.[a.id]
            return (
              <li key={a.id} className="border-b border-hairline py-3 last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={d.include}
                    aria-label={`Include ${a.org}, ${a.role}`}
                    onClick={() => set(a.id, { include: !d.include })}
                    className="touch-target mt-0.5 grid size-[18px] shrink-0 cursor-pointer place-items-center rounded border border-hairline text-transparent transition-colors hover:border-accent aria-checked:border-accent aria-checked:bg-accent aria-checked:text-primary-foreground"
                  >
                    <Check className="size-3" strokeWidth={3} aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-1">
                      {a.org} <span className="text-text-3">·</span> {a.role}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
                      {role ? <span className="text-text-2">{CONTACT_ROLE_LABEL[role]}</span> : null}
                      <span>{STAGE_LABEL[a.stage]}</span>
                      {date ? <span>Applied {date}</span> : null}
                      <span>
                        {count === 0 ? 'No materials filed' : `${count} material${count === 1 ? '' : 's'}`}
                      </span>
                      {a.url ? (
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-accent hover:underline"
                        >
                          Posting
                          <ExternalLink className="size-3" strokeWidth={1.8} aria-hidden />
                        </a>
                      ) : (
                        <span>No posting link</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Only for a ticked row: an unticked one is not being sent, and
                    six empty fields under it would be noise. What was typed is
                    kept while it is unticked. */}
                {d.include ? (
                  <div className="mt-2.5 grid gap-2.5 pl-[28px]">
                    <Field
                      label="Highlight"
                      value={d.highlights}
                      placeholder="e.g. teaching, NSF CAREER, causal inference"
                      hint="Separate with commas."
                      onChange={(e) => set(a.id, { highlights: e.target.value })}
                    />
                    <TextareaField
                      label="Note for them"
                      rows={2}
                      maxLength={MAX_BRIEF_NOTE_TEXT}
                      value={d.note}
                      placeholder="Anything else: the deadline, who to address it to, what the department cares about."
                      onChange={(e) => set(a.id, { note: e.target.value })}
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <fieldset className="flex items-center gap-1.5">
            <legend className="sr-only">File format</legend>
            {(['xlsx', 'csv'] as const).map((f) => (
              <label
                key={f}
                className={cn(
                  'cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors',
                  format === f ? 'border-accent text-text-1' : 'border-hairline text-text-3 hover:text-text-2',
                )}
              >
                <input
                  type="radio"
                  name="referee-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="sr-only"
                />
                {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}
              </label>
            ))}
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={withMaterials}
              onChange={(e) => setWithMaterials(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Include my materials{documentCount > 0 ? ` (${documentCount})` : ''}
          </label>
        </div>

        <DialogFooter className="mt-4">
          <p className="text-xs text-text-3 sm:mr-auto sm:self-center">
            {chosen.length === 0
              ? 'Tick at least one application.'
              : `${chosen.length} application${chosen.length === 1 ? '' : 's'}${
                  withMaterials && documentCount > 0 ? ', as one .zip' : ''
                }`}
          </p>
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              saveBriefs()
              onOpenChange(false)
              toast({ title: 'Highlights saved', description: person.name })
            }}
          >
            Save
          </Button>
          <Button size="sm" disabled={busy || chosen.length === 0} onClick={() => void download()}>
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            {busy ? 'Preparing…' : 'Download'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
